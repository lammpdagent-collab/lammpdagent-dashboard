## Why

Dashboard 現時只有 guestbook 測試用的 `messages` 表，無法承載任務與日程。Personal Command Center 的第一步是建立資料層：三張表（任務、日曆事件、同步狀態），並在 DB 層落實權限（RLS）與即時推送（Realtime）。

現時 Dickson 的任務與日程分散在 Obsidian vault 與兩個 Google Calendar，dashboard 冇任何持久資料可讀。冇資料層，Phase 2 的前端與 Phase 3 的同步都無法開始。

## What Changes

- 新增 `public.tasks`：任務資料模型（4 級 priority、`todo/done/park` 狀態、pinned、tags、markdown notes、source_ref 防重複）
- 新增 `public.events`：日曆事件鏡像（複合 id 保證 upsert 冪等、account_key 區分私人／學校、relevance 分層、cancelled_at 標記）
- 新增 `public.system_meta`：每個同步來源一行的狀態記錄（`calendar_sync:personal` / `calendar_sync:work`），帶 `detail JSONB` 存 fetched count
- 為三張表啟用 RLS：`tasks` 可讀寫（soft delete，無 DELETE 權限）、`events` 與 `system_meta` 只讀，全部限單一 owner email
- 為 `tasks` 加 `updated_at` trigger；為 `events` 設 `REPLICA IDENTITY FULL`
- 將三張表加入 `supabase_realtime` publication（用 idempotent DO block）
- **BREAKING**：DROP `public.messages`（guestbook 測試已完成，現時 dashboard 首頁會失效，待 Phase 2 重寫）

## Capabilities

### New Capabilities

- `task-management`: 任務的資料模型、狀態機（todo / done / park）、4 級 priority、soft delete 與 RLS 寫入邊界
- `calendar-events`: 日曆事件的資料模型、帳號隔離、取消標記、保留策略與只讀權限
- `sync-status`: 同步來源的狀態記錄格式，供前端顯示新鮮度與 n8n 判斷是否安全執行清理

### Modified Capabilities

（無 — `guestbook` spec 不動，只刪除其對應的 `messages` 表。Phase 1 完成後另開 change 移除該 spec。）

## Impact

- `supabase/migrations/` 新增一個 migration 檔案
- 前端 `src/` 暫時失效（`messages` 表被刪），Phase 2 重寫
- `.github/workflows/deploy.yml` 不變（仍會 build 現有程式碼，但會 build 失敗風險 → 見 design 的部署處理）
- 不影響 Git history、Pages 設定、Google OAuth 設定
- n8n credentials 不變
