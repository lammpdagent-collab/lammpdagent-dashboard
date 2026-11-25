-- Personal Command Center Phase 1 —— 一次過建立三張表（tasks / events / system_meta），
-- 連同索引、updated_at trigger、RLS、精確權限、Realtime publication。
-- 三段：1) 建表 + 索引 + trigger  2) RLS + 權限 + Realtime  3) 清理（DROP messages）。
--
-- BREAKING（design D12）：本 migration 會 DROP public.messages（guestbook 測試表）。
-- 現有前端（src/lib/repository.ts）喺運行時會失敗，dashboard 顯示載入錯誤，
-- 待 Phase 2 重寫前端後恢復（design R1，Dickson 已接受）。
--
-- Note: `supabase db push` wraps each migration file in one transaction, so a
-- mid-file error rolls back the whole file. Running this with `psql -f` does NOT
-- give that guarantee. Always deploy via the Supabase CLI.

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text not null default '',        -- markdown 原文，空串合法
  due_date     date,
  priority     text not null default 'medium',
  category     text not null default 'work',
  status       text not null default 'todo',
  pinned       boolean not null default false,
  tags         text[] not null default '{}',
  source       text not null default 'web',     -- default 係必要：spec「只提供 title 即可建立任務」
  source_ref   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at   timestamptz,
  -- 擋視覺空白：同一串 E'' 字元集同 messages migration 完全一致（改嘅時要一齊改）。
  -- 長度以清完集合之後計，並要求儲存值首尾必須已 trim（= btrim(title, <集合>)）。
  constraint tasks_title_len check (
    char_length(btrim(title, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')) between 1 and 200
    and title = btrim(title, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')
  ),
  constraint tasks_priority_check check (priority in ('critical', 'high', 'medium', 'low')),
  constraint tasks_category_check check (category in ('work', 'personal', 'other')),
  constraint tasks_status_check   check (status in ('todo', 'done', 'park')),   -- 'waiting' 被拒（design D7）
  constraint tasks_source_check   check (source in ('telegram', 'web')),
  -- invariant：completed_at 只可以喺 status='done' 時出現。BEFORE trigger 先行
  -- （補返／清走 completed_at），CHECK 後行，所以正常 update 唔會被呢條擋住。
  constraint tasks_completed_at_check check (status = 'done' or completed_at is null)
);

create table public.events (
  id              text primary key,              -- '{account_key}_{google_event_id}'，無預設（design D2）
  google_event_id text not null,
  title           text not null default '',
  description     text not null default '',
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  is_all_day      boolean not null default false,
  location        text not null default '',
  account_key     text not null,
  source_calendar text,
  relevance       text not null default 'context',
  day_cycle       text,
  series_id       text,
  recurrence_note text,
  cancelled_at    timestamptz,
  calendar_status text not null default 'confirmed',
  last_synced_at  timestamptz not null default now(),
  constraint events_account_key_check check (account_key in ('personal', 'work')),
  constraint events_relevance_check   check (relevance in ('linked', 'context', 'noise')),
  -- 擋 id 同 (account_key, google_event_id) 唔一致嘅手拼／偽造主鍵
  constraint events_id_check check (google_event_id <> '' and id = account_key || '_' || google_event_id),
  -- 擋時序倒錯（end 早過 start）
  constraint events_time_check check (end_time >= start_time)
);

create table public.system_meta (
  key         text primary key,                  -- 每個來源一行（design D6）
  last_run_at timestamptz not null default now(),
  status      text not null default 'init',
  detail      jsonb,
  message     text,
  constraint system_meta_status_check check (status in ('ok', 'error', 'init', 'stale')),
  -- 擋非 calendar_sync:* 嘅 key 混入呢張表
  constraint system_meta_key_check check (key ~ '^calendar_sync:[a-z]+$')
);

-- 未完成任務列表（todo / park，含冇 due_date）
create index tasks_status_due_date_idx on public.tasks (status, due_date) where status <> 'done';

-- 同一 telegram 訊息重送被擋；NULL 唔受限制（spec source_ref / P1-15）
create unique index tasks_source_ref_key on public.tasks (source_ref) where source_ref is not null;

create index events_start_time_idx on public.events (start_time);

create index events_account_key_last_synced_idx on public.events (account_key, last_synced_at);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  -- 任務轉為 done 而 completed_at 仍為 NULL 時自動記錄完成時間
  -- （task-management spec「標記完成時自動記錄時間」；客戶端明式提供嘅值唔會被覆寫）
  if new.status = 'done' and new.completed_at is null then
    new.completed_at = now();
  end if;
  -- owner 修正 2026-11-26：任務離開 done（退回 todo / park）就清除完成時間，
  -- 唔會殘留過期 completion timestamp。同上一分支互斥（status='done' 唔會入嚟）。
  -- Scope the clear to UPDATE only, so an INSERT carrying a stale completed_at hits the CHECK and fails loudly instead of being silently nulled.
  if new.status <> 'done' and TG_OP = 'UPDATE' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

-- trigger function 係內部實作，client 冇需要亦唔應該直接執行。
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger tasks_touch_updated_at
  before insert or update on public.tasks
  for each row
  execute function public.touch_updated_at();

alter table public.events replica identity full;

alter table public.tasks       enable row level security;
alter table public.events      enable row level security;
alter table public.system_meta enable row level security;

-- tasks：select / insert / update 三條，全部限 owner email。
-- 刻意唔建 DELETE policy（design D4：軟刪除，owner 冇實體刪除權）。
create policy "owner can read tasks"
  on public.tasks for select
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com');

create policy "owner can insert tasks"
  on public.tasks for insert
  to authenticated
  with check (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com');

create policy "owner can update tasks"
  on public.tasks for update
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com');

-- events：只讀（寫入只由 service_role 做，design D5）
create policy "owner can read events"
  on public.events for select
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com');

-- system_meta：只讀
create policy "owner can read system_meta"
  on public.system_meta for select
  to authenticated
  using (lower(auth.jwt() ->> 'email') = 'lammpd.agent@gmail.com');

-- Supabase 對 public schema 新表預設 grant ALL 俾 anon/authenticated；
-- grant 係加法，淨係 grant select 收唔返 ALL，所以先 revoke 再窄 grant
-- （同 messages migration 同一做法）。service_role 唔掂：佢本來就 bypass RLS。
revoke all on table public.tasks       from anon, authenticated;
revoke all on table public.events      from anon, authenticated;
revoke all on table public.system_meta from anon, authenticated;

-- anon 零 grant（owner 修正 2026-11-26）：revoke all 之後唔 grant 返任何嘢俾 anon。
-- anon SELECT → permission denied（401/403），「攞唔到任何資料」的驗收目的不變；
-- 就算 RLS policy 被誤刪，anon 仍然讀不到（defence-in-depth）。9.1 接受兩種結果。
grant select on table public.tasks       to authenticated;
grant select on table public.events      to authenticated;
grant select on table public.system_meta to authenticated;

-- tasks 寫入只限 authenticated（owner）。
-- id / created_at / updated_at 由 DB 控制（default + trigger）：column-level insert grant
-- 唔包含佢哋，client 指定呢啲欄會被 Postgres 拒絕（同 messages 防止 created_at='infinity'
-- 擠前嘅做法一致）。
-- completed_at 係 trigger 擁有（填／清都由 trigger 做），唔入 column grant，防 client 注入偽造（如 'infinity'）完成時間。
grant insert (title, notes, due_date, priority, category, status, pinned, tags, source, source_ref, deleted_at)
  on table public.tasks to authenticated;
-- UPDATE 收窄至欄級（owner 修正 2026-11-26）：排除 id / created_at / updated_at /
-- source_ref / source。updated_at 由 trigger 擁有（client 俾咗都會被覆寫，denying 令
-- 呢個錯誤唔可能發生）；source / source_ref 係來源系統身份，建立後唔應該改。
-- completed_at 係 trigger 擁有（status 轉 done 自動填、離開 done 自動清），同樣唔開放俾 client 直接寫。
grant update (title, notes, due_date, priority, category, status, pinned, tags, deleted_at)
  on table public.tasks to authenticated;

-- 冪等：已在 publication 就跳過，重複執行唔報錯。
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime absent - skipping realtime setup';
  else
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'tasks'
    ) then
      alter publication supabase_realtime add table public.tasks;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'events'
    ) then
      alter publication supabase_realtime add table public.events;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'system_meta'
    ) then
      alter publication supabase_realtime add table public.system_meta;
    end if;
  end if;
end;
$$;

-- BREAKING（design D12）：guestbook 測試已完成，資料無保留價值（2 行測試資料）。
-- 現有前端（src/lib/repository.ts 查 messages）會喺運行時失敗，
-- 待 Phase 2 重寫前端後恢復。Dickson 已知悉並接受中間狀態。
drop table if exists public.messages;

-- Migration 完。單一 transaction 保證只適用於經 `supabase db push` 部署
-- （準確描述見檔首 Note）；用 psql -f 跑呢個檔冇同一保證。
