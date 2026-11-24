## Context

Repo `lammpdagent-dashboard` 目前只有骨架：Vite + TypeScript + Vitest、`@supabase/supabase-js` 已裝、`.env` 已有 Supabase URL 同 publishable key、`supabase/.temp/project-ref` 指向 cloud project `tmgnqofsyyaigilqkonv`（ap-southeast-1）。`supabase/migrations/` 係空，`openspec/specs/` 係空。Repo 係 private，未有任何 CI。

目標係用最小實作驗證 GitHub Pages + Supabase 嘅完整鏈路：靜態前端 → anon key → Postgres（RLS）。唔追求功能完整度。

## Goals / Non-Goals

**Goals:**

- 一條 migration 建立 `messages` 同 RLS，可 `supabase db push` 落 cloud
- 前端純函數邏輯（驗證、查詢、顯示格式化）可被 vitest 覆蓋，唔需要 jsdom
- 同一個 build 產物同時喺本機 `npm run dev` 同 GitHub Pages subpath 正常運作
- Push 上 `main` 自動部署

**Non-Goals:**

- 用户帳號、登入、刪除／編輯留言、分頁、無限滾動
- 留言審核、敏感字過濾、rate limiting
- 自訂網域、SEO、SSR
- 本機 Supabase stack（`supabase start`）— 直接對 cloud project 開發，因為呢個 repo 只有一個 developer 同一個 demo DB

## Decisions

### D1. Schema

```sql
create table public.messages (
  id         bigint generated always as identity primary key,
  name       text not null,
  message    text not null,
  created_at timestamptz not null default now(),
  constraint messages_name_len    check (char_length(btrim(name)) between 1 and 30),
  constraint messages_message_len check (char_length(btrim(message)) between 1 and 500)
);
create index messages_created_at_idx on public.messages (created_at desc);
```

用 CHECK constraint 而唔止前端驗證 — 前端可繞過，DB 唔可以。`btrim` 令純空白名稱唔可能通過。`generated always as identity` 比 `serial` 好（唔會撞 sequence 權限問題）。

`created_at` 用 `timestamptz`，顯示時才轉 `Asia/Hong_Kong`。

### D2. RLS

```sql
alter table public.messages enable row level security;
create policy "anon can read messages"  on public.messages for select to anon, authenticated using (true);
create policy "anon can insert message" on public.messages for insert to anon, authenticated with check (true);

-- Supabase cloud 預設 auto_expose_new_tables = true，新表已自動 grant ALL 俾 anon/authenticated。
-- grant 係加法，補一句窄 grant 收唔返 update/delete，所以要先 revoke 再窄 grant。
revoke all on table public.messages from anon, authenticated;
grant select, insert on table public.messages to anon, authenticated;
```

**唔建立 UPDATE / DELETE policy** — 冇 policy 即拒絕，比寫 `using (false)` 更難出錯。`id` 係 identity 欄，`grant insert` 唔等於可以指定 `id`。

Supabase cloud 預設 `auto_expose_new_tables = true`：`public` schema 新表自動 grant 全部權限俾 `anon` / `authenticated`。Grant 係加法 — 後補一句窄 `grant select, insert` 收唔返已發出去嘅 update/delete，所以 migration 先 `revoke all` 再窄 grant，令「只可讀同新增」成為 DB privilege 層面事實，而唔止靠 RLS 冇 policy。

### D3. 前端分層

| 檔案 | 責任 |
|---|---|
| `src/lib/supabase.ts` | 建立 client，用 `readEnv` 讀 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `src/lib/guestbook.ts` | 純邏輯：`validateMessage()`、`formatTimestamp()`、`normaliseRow()` |
| `src/lib/repository.ts` | Supabase 查詢封裝：`fetchLatest(3)`、`insertMessage()` — 只依賴注入嘅 client 介面 |
| `src/main.ts` | 只做 DOM 綁定同事件接線 |
| `index.html` | 表單 + 列表容器 + 空狀態／錯誤容器 |

`repository.ts` 收 `Pick<SupabaseClient, 'from'>` 之類嘅最小介面，令 test 可以餵假 client，唔使連網。呢個係 AGENTS.md「邏輯放 `src/lib/`，`main.ts` 只做接線」嘅直接應用。

### D4. 驗證用 code point 計長度

`[...value.trim()].length` 而唔係 `.length` — `'👍'.length === 2` 但 code point 係 1。Spec 寫明 code point，實作要一致。前端驗證同 DB `char_length()` 嘅計法要對齊（Postgres `char_length` 都係計 code point，唔計 UTF-16 units）。

### D5. Vite base 同 GitHub Pages

`vite.config.ts` 加 `base: '/lammpdagent-dashboard/'`，因為 project page 網址係 `https://<user>.github.io/lammpdagent-dashboard/`。用 `base` 而唔係相對路徑，係因為 SPA 資源用絕對路徑較少踩錯。

Build 時注入環境變數：GitHub Actions 由 repo **Variables**（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`）寫入 `.env`。呢兩個值本身係 public-safe（publishable key 受 RLS 保護），用 Variables 而唔用 Secrets 更符合實際。

`SUPABASE_SERVICE_ROLE_KEY` 永遠唔會出現喺 CI 或 client bundle。

### D6. 時間顯示

`Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' })`。用固定 timezone 而唔係瀏覽器本地時區 — 訪客喺外國都睇到同一個香港時間，減少「點解時間唔同」嘅混淆。

### D7. 錯誤處理

兩類錯誤分開顯示：

- **驗證錯誤**（前端）：逐欄位指出，唔會發請求
- **網絡／DB 錯誤**：顯示「提交失敗，請再試」，保留輸入內容，唔清空表單

唔將 Postgres 錯誤原文（可能含 schema 資訊）直接顯示俾用戶，只 log 落 console。

### D8. 測試範圍

純函數（`validateMessage`、`formatTimestamp`、`normaliseRow`、長度計算）用 vitest。`repository.ts` 用假 client 測「呼叫咗正確嘅 from/select/order/limit」同錯誤傳播。DOM 綁定唔測 — 冇 jsdom，人工驗證。

## Risks / Trade-offs

- **[Repo 轉 public 會 expose 所有 git history]** → 轉之前確認 history 冇 secret。`.env` 一直喺 `.gitignore`，但要實地核對 `git log --all -- .env` 冇紀錄。
- **[Publishable key 曝光]** → 設計上就係公開嘅；保護來自 RLS + CHECK constraint。冇 RLS 嘅 table 會全開，所以 migration 一定要同 table 一齊落。
- **[直接對 cloud 開發，冇本地 stack]** → 每次 `db push` 都係真實改動。改動只限新 table，冇現有資料可破壞。如果日後有真實用戶資料，必須轉用本地 stack 先行驗證。
- **[GitHub Pages 需要 repo public]** → 任何 clone 到嘅人都可以 fork 前端，但佢哋只會拿到 publishable key，受 RLS 限制。
- **[免費 tier 額度]** → 留言板流量極低，兩個 free project 之一已經用咗，唔會觸發額外收費。
- **[並發插入時最新 3 條可能抖動]** → 單一 demo 場景可接受；重新整理即可。

## Migration Plan

1. 寫 `supabase/migrations/<timestamp>_create_messages.sql`
2. `supabase db push`（cloud）
3. `supabase migration list --remote` + `supabase db diff --remote` 確認無 drift
4. 前端 build + 本機驗證
5. Repo 轉 public → 開 GitHub Pages（source = GitHub Actions）→ 首次 deploy
6. 失敗回滾：`drop table public.messages` 新 migration；前端 revert commit 即回骨架狀態

## Open Questions

- 無。所有決策已由 proposal 嘅 scope 同 Dickson 嘅三個選擇（現有 repo / GitHub Pages / 暱稱 + 內容）收斂。
