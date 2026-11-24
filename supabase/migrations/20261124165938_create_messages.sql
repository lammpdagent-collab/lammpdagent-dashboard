create table public.messages (
  id         bigint generated always as identity primary key,
  name       text not null,
  message    text not null,
  created_at timestamptz not null default now(),
  -- 擋視覺空白：btrim(name) 預設只清 ASCII 空格，所以明確列出要清嘅字元集合。
  -- 兩個 constraint 必須共用下面同一串 E'' 字元集（改嘅時要一齊改），包含：
  --   U+0020 空格、U+0009 tab、U+000A LF、U+000B VT、U+000C FF、U+000D CR、
  --   U+00A0 NBSP、U+1680 OGHAM SPACE、U+2000–U+200A 空格系列、U+200B ZWSP、
  --   U+2028 LINE SEPARATOR、U+2029 PARAGRAPH SEPARATOR、U+202F 窄 NBSP、
  --   U+205F 數學空格、U+2060 WORD JOINER、U+3000 全角空格、U+FEFF BOM／ZWNBSP、
  --   U+180E MONGOLIAN VOWEL SEPARATOR（歷史 whitespace）。
  -- 字元集統一用 E'' 內嘅 \uXXXX（Postgres E'' 冇 \v escape，會變字面 backslash+v），
  -- 唔依賴 locale。長度以清完呢個集合之後計（唔用預設 btrim 單參數，避免 ASCII 空格墊長度）；
  -- 並要求儲存值首尾必須已 trim（name = btrim(name, <集合>)）——
  -- 前端一律先 trim 先送，正常 UI 路徑唔受影響；直接打 API 送未 trim 值會被拒。
  constraint messages_name_len check (
    char_length(btrim(name, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')) between 1 and 30
    and name = btrim(name, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')
  ),
  constraint messages_message_len check (
    char_length(btrim(message, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')) between 1 and 500
    and message = btrim(message, E'\u0020\u0009\u000a\u000b\u000c\u000d\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u2028\u2029\u202f\u205f\u2060\u3000\ufeff\u180e')
  )
);

create index messages_created_at_idx on public.messages (created_at desc);

alter table public.messages enable row level security;

create policy "anon can read messages"
  on public.messages for select
  to anon, authenticated
  using (true);

create policy "anon can insert message"
  on public.messages for insert
  to anon, authenticated
  with check (true);

-- Supabase 對 public schema 新表預設 grant ALL 俾 anon/authenticated；
-- grant 係加法，淨係 grant select, insert 收唔返 ALL，所以先 revoke 再窄 grant。
-- service_role 唔掂：佢本來就 bypass RLS。
revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to anon, authenticated;
-- column-level insert grant：id（generated always as identity）同 created_at（default now()）
-- 由 DB 控制；client insert 指定呢啲欄會被 Postgres 拒絕（permission denied for column），
-- 唔會插入 created_at = 'infinity' 排最前擠走真實留言。
grant insert (name, message) on table public.messages to anon, authenticated;
