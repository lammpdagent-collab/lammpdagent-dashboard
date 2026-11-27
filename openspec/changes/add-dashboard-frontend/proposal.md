## Why

Phase 1 已建立並上線資料層（`tasks` / `events` / `system_meta`），但 `public.messages` 已 DROP，而前端 `src/` 仍然查該表，所以 dashboard 現時**完全載入失敗**。Dickson 需要一個可以每日實際使用的前端：睇任務、一鍵剔完成、睇未來日程。

Phase 2 另外發現兩個資料層缺口，必須同時補：

1. **tag 目錄無處儲存** —— `tasks.tags` 只記錄「已被使用的 tag」，無法預先建立或管理一個獨立目錄。Dickson 明確要求「新增 tag 入 list／從 list 移除 tag」。
2. **校曆 Day A–F 無處儲存** —— `system_meta` 的 `system_meta_key_check` 約束寫死 `^calendar_sync:[a-z]+$`，擋住 `cycle_days` 這類 key；而 `events.day_cycle` 在 Doc1 的模型中無對應語義（Cycle Day 不是 event）。

## What Changes

- 新增 `public.tags`：獨立 tag 目錄（`name` 主鍵），前端可讀寫，限單一 owner
- 新增 `public.cycle_days`：校曆循環日對照（`date` 主鍵 + `day_label` A–F），n8n 寫、前端只讀
- 新增 `public.is_owner()`：回傳 boolean，供前端判斷登入者是否 owner（避免前端硬編 email）
- 重寫前端 `src/`（Vite + TypeScript + Vitest），實作：Google 登入、任務區、事件區、同步狀態警告、PWA manifest
- 移除 guestbook 前端程式碼與其測試（`messages` 表已於 Phase 1 DROP）
- **不新增任何 `events` / `tasks` 欄位** —— Phase 1 的 schema 不變

## Capabilities

### New Capabilities

- `dashboard-ui`: 前端行為規格 —— 登入、任務區（新增／完成／pin／展開編輯／tag 選取）、事件區（Today / Tomorrow / Upcoming 分組、跨日與已過事件處理）、同步狀態異常提示、錯誤與空狀態、時間格式
- `tag-catalog`: tag 目錄的資料模型與管理邊界（新增、移除、移除使用中 tag 的確認與批量清理）
- `cycle-day-calendar`: 校曆循環日對照表的資料模型與讀取規則

### Modified Capabilities

（無 —— `task-management` / `calendar-events` / `sync-status` 的 Phase 1 規格全部維持不變。顯示層規則屬 `dashboard-ui`，不動資料模型規格。）

## Impact

- `supabase/migrations/` 新增一個 migration（2 張表 + RLS + grants）
- `src/` 全部重寫；`tests/` 重寫（guestbook 測試移除）
- 新增 `public/manifest.json` 與相關 meta
- `.github/workflows/deploy.yml` 不變（仍然 `npm test` → `npm run build` → Pages）
- n8n：日後需新增兩個 workflow（sync `cycle_days`、維護 tag 目錄），但不在本 change 範圍
- 不動 Google OAuth 設定、不動 Phase 1 已上線的三張表

## 移除說明：guestbook capability 已廢除

`guestbook` 是 Phase 0 的 POC（驗證 Supabase 連通 / RLS / Realtime）。它的 DB 表（`public.messages`）、前端程式碼、測試都在本 change 之前／期間被移除。

**處理方式（依 PROJECT.md §4.3 規則 A）**：整個 capability 廢除，`openspec/specs/guestbook/` 目錄已手動刪除，**不經 `REMOVED` delta** —— 因為全部 requirement 被移除會令 `archive` abort（`Spec must have at least one requirement`），而該 abort 是設計上的 tripwire，不是 bug。

`openspec/changes/archive/2026-11-24-add-guestbook/` 保留，作為歷史記錄。

