## 1. OpenSpec 與前置

- [x] 1.1 `openspec validate add-calendar-sync --strict` 通過
- [x] 1.2 Gate 1：acceptance criteria 由 Dickson 批准
- [x] 1.3 `oc plan` 產出計畫，Gate 2 批准

## 2. n8n workflow

- [x] 2.1 建立 workflow `calendar-sync`，含兩個 Schedule Trigger（`0 * * * *` / `30 * * * *`）
- [x] 2.2 共用子流程：讀取日曆清單 → 過濾「5. 教師生日」→ 逐個 calendar 抓 events
- [x] 2.3 personal 分支：3 個日曆全部讀
- [x] 2.4 work 分支：6 個日曆讀，並從「2. 學生相關」派生 cycle_days
- [x] 2.5 增量比對：先查 DB 現有 (id, last_synced_at)，只送新建或 `updated` 較新的
- [x] 2.6 upsert 至 `public.events`（`on_conflict=id`，`last_synced_at = batch_time` 顯式帶入）
- [x] 2.7 cleanup：綁定 `account_key` + `start_time` 窗口 + `last_synced_at < batch_time`
- [x] 2.8 寫入 `public.system_meta`（ok / error + detail）
- [x] 2.9 backfill 分支：`timeMin = 2026-08-01`，手動觸發一次

## 3. cycle_days 派生

- [x] 3.1 regex 支援全形 `Ａ-Ｆ`（U+FF21–FF26）與半形 `A-F`
- [x] 3.2 全形轉半形再寫入 `day_label`
- [x] 3.3 只從 work「2. 學生相關」派生
- [x] 3.4 upsert 至 `public.cycle_days`（`on_conflict=date`）

## 4. 安全與驗證

- [x] 4.1 檢查 workflow JSON：所有 Google Calendar node 只有 `getAll` / `get`
- [x] 4.2 檢查 work 分支的 credential 綁定正確（唔會誤用 personal）
- [x] 4.3 測試 cleanup：先跑 30 天 sync，確認 30–90 天資料未變
- [x] 4.4 測試增量：連續跑兩次，第二次寫入 0 行

## 5. 版控與部署

- [x] 5.1 匯出 workflow JSON 至 `n8n/workflows/calendar-sync.json`
- [x] 5.2 commit（workflow JSON + 本 change 的 openspec 檔案）
- [x] 5.3 啟用排程，觀察 2 次執行

## 6. 端到端驗收

- [x] 6.1 `events` 表 >= 1,500 行
- [x] 6.2 `cycle_days` 90 天內 >= 42 行
- [x] 6.3 抽樣 3 個事件與 Google Calendar 一致
- [x] 6.4 dashboard 事件區顯示真實資料（Today / Tomorrow / Upcoming）
- [x] 6.5 在 Google 刪一個未來事件，30 分鐘內 dashboard 消失（或變灰）
- [x] 6.6 `system_meta` 兩個帳號都 `status='ok'`
- [x] 6.7 **Dickson 手動驗證**：dashboard 事件區與 Google Calendar 對照
- [x] 6.8 `openspec archive add-calendar-sync`

## 7. 文件

- [x] 7.1 `PROJECT.md` §7 D7（n8n workflow 未版控）打 ✅
- [x] 7.2 `AGENTS.md` 加 n8n workflow 說明（如適用）
- [x] 7.3 Phase 3 決策記錄建立
