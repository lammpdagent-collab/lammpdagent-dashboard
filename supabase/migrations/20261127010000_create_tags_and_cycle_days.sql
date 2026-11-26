-- Personal Command Center Phase 1b —— tags（tag 目錄）與 cycle_days（校曆循環日）。
-- 唔改 Phase 1 三張表；RLS / grants / publication 手法與 20261126004259 一致。
--
-- 維護警告：is_owner() 內嘅 owner email 與 Phase 1 五條 policy 嘅字面值
-- 必須一致；改 owner 時兩處一齊改（同 tasks_title_len 集合字串嘅維護方式相同）。

create table public.tags (
  name       text primary key,
  created_at timestamptz not null default now(),
  -- 擋視覺空白（m4）：同一串 E'' 字元集同 Phase 1 tasks_title_len（20261126004259）
  -- 完全一致——btrim(name) 預設只剪 ASCII space，會放行 tab／全形空白等
  -- 「視覺空白」tag。長度以清完集合之後計，並要求儲存值首尾必須已 trim
  -- （= btrim(name, <集合>)），否則 '  SEN  ' 會同 'SEN' 並存成兩個 tag。
  -- 改呢個集合時要連 Phase 1 tasks_title_len 一齊改。
  constraint tags_name_check check (
    char_length(btrim(name, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')) between 1 and 40
    and name = btrim(name, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')
  )
);

create table public.cycle_days (
  date       date primary key,
  day_label  text not null,
  updated_at timestamptz not null default now(),
  constraint cycle_days_label_check check (day_label ~ '^[A-F]$')
);

-- updated_at 由 trigger 獨佔（n8n upsert 唔使理；client 冇 update grant）
create function public.set_cycle_days_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

revoke execute on function public.set_cycle_days_updated_at() from public, anon, authenticated;

create trigger cycle_days_touch_updated_at
  before update on public.cycle_days
  for each row execute function public.set_cycle_days_updated_at();

-- owner 判定（design D13）：email 只存 DB；前端經 RPC 攞 boolean，bundle 零 email。
create function public.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'lammpd.agent@gmail.com'
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

alter table public.tags       enable row level security;
alter table public.cycle_days enable row level security;

create policy "owner can read tags"
  on public.tags for select to authenticated using (public.is_owner());
create policy "owner can insert tags"
  on public.tags for insert to authenticated with check (public.is_owner());
create policy "owner can delete tags"
  on public.tags for delete to authenticated using (public.is_owner());
create policy "owner can read cycle_days"
  on public.cycle_days for select to authenticated using (public.is_owner());

-- 同 Phase 1：先 revoke 預設 ALL 再窄 grant；anon 零權限（401，唔係 0 行）
revoke all on table public.tags       from anon, authenticated;
revoke all on table public.cycle_days from anon, authenticated;

grant select, delete on table public.tags to authenticated;
-- 欄級 insert：created_at 由 DB default 管（同 tasks 防偽造 created_at 同理）
grant insert (name) on table public.tags to authenticated;
grant select on table public.cycle_days to authenticated;

-- 兩表入 publication（冪等，Phase 1 同款 DO block；R1-2 拍板 cycle_days 都入）
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime absent - skipping realtime setup';
  else
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tags') then
      alter publication supabase_realtime add table public.tags;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cycle_days') then
      alter publication supabase_realtime add table public.cycle_days;
    end if;
  end if;
end;
$$;
