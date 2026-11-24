## 1. Database

- [x] 1.1新增 `supabase/migrations/<timestamp>_create_messages.sql`：`messages` table、兩個 CHECK constraint、`created_at desc` index
- [x] 1.2同一條 migration 內 `enable row level security`、加 select／insert policy、`grant select, insert to anon, authenticated`
- [ ] 1.3 `supabase db push` 落 cloud，然後 `supabase migration list --remote` 同 `supabase db diff --remote` 都要乾淨
- [ ] 1.4 用 anon key 實測：select 成功、insert 成功、update 同 delete 被拒絕（`supabase db diff` 之後再跑一次確認冇 drift）

## 2. Application logic (`src/lib/`)

- [x] 2.1`src/lib/supabase.ts`：用 `readEnv` 建立 client 並 export singleton
- [x] 2.2`src/lib/guestbook.ts`：`MAX_NAME_LEN = 30`、`MAX_MESSAGE_LEN = 500`、`codePointLength()`、`validateMessage()` 回傳逐欄位錯誤、`formatTimestamp()` 用 `Asia/Hong_Kong`、`normaliseRow()`
- [x] 2.3`src/lib/repository.ts`：`fetchLatest(limit)` 按 `created_at desc`、`insertMessage({name, message})`，兩者接收入注入嘅最小 client 介面
- [x] 2.4`tests/guestbook.test.ts`：驗證 trim、空白拒絕、邊界 30／500、超長、emoji 以 code point 計、時間格式化固定 HKT
- [x] 2.5`tests/repository.test.ts`：用假 client 驗證正確呼叫 `from('messages')`、`.select()`／`.insert()`、`.order('created_at', {ascending:false})`、`.limit(3)`，以及 Supabase error 會向上拋

## 3. UI (`index.html` + `src/main.ts`)

- [x] 3.1`index.html`：留言表單（暱稱、內容、提交按鈕）、錯誤訊息區、留言列表區、空狀態提示
- [x] 3.2`src/main.ts`：載入時 `fetchLatest(3)` 渲染列表，空陣列顯示「暫無留言」
- [x] 3.3提交流程：驗證 → 失敗顯示逐欄位錯誤且不發請求 → 成功寫入 → 重新載入列表 → 清空輸入
- [x] 3.4提交期間停用按鈕（`disabled`），請求結束後（無論成功失敗）恢復
- [x] 3.5DB／網絡錯誤顯示統一訊息並保留輸入內容；Postgres 原文只入 `console.error`
- [x] 3.6基本樣式：可讀、窄螢幕可用，唔引入 UI 框架

## 4. Build 與部署

- [x] 4.1`vite.config.ts` 加 `base: '/lammpdagent-dashboard/'`
- [x] 4.2`.github/workflows/deploy.yml`：`npm ci` → 由 `vars.VITE_SUPABASE_URL` / `vars.VITE_SUPABASE_PUBLISHABLE_KEY` 寫 `.env` → `npm run build` → publish Pages artifact
- [ ] 4.3 Repo 轉 public 前檢查 git history 冇 secret（`git log --all -- .env`、`git grep` 掃 `sb_secret`／`service_role`）
- [ ] 4.4 GitHub repo Variables 加入兩個 `VITE_` 值；Pages source 設為 GitHub Actions
- [ ] 4.5 首次 deploy 後開 Pages 網址，確認資源無 404、列表載入、提交成功

## 5. 驗證

- [x] 5.1`npm run typecheck`、`npm test`、`npm run build` 全部通過
- [ ] 5.2 `npm run db:check` 乾淨（無 drift）
- [ ] 5.3 本機 `npm run dev` 與 GitHub Pages 網址各完成一次「提交 → 見到新留言」
- [ ] 5.4 更新 `AGENTS.md`（如 deployment 流程需要記錄）
