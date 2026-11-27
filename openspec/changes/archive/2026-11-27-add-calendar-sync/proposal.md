## Why

Phase 1 建立並上線了 `events` / `system_meta` / `cycle_days` 三張表，Phase 2 前端已上線並可讀取，但**冇任何東西負責寫入** —— 結果 `events` 表 0 行、`cycle_days` 表 0 行，dashboard 的事件區永遠空白。

Phase 3 要填補這個缺口：由 n8n 定時從 Google Calendar 讀取，寫入 Supabase，令 dashboard 有真實資料，並讓 Phase 4 的早報（briefing）有資料來源。

## What Changes

- 新增 n8n workflow（2 條定時分支）：整點抓 90 天、半點抓 30 天
- 從 Google Calendar 讀取 personal（3 個日曆）+ work（6 個日曆，排除「5. 教師生日」）
- 寫入 `public.events`（增量：只寫有變更的行，用 Google `updated` 欄位比對）
- 從 work「2. 學生相關」的 Day event 派生寫入 `public.cycle_days`
- 每次執行寫入 `public.system_meta`（status / last_run_at / detail）
- 首次 backfill 自 2026-08-01（26-27 學年開學）
- **不做** `REPLICA IDENTITY FULL`（設計上唔 DELETE，DEFAULT 已足夠）
- **不寫 Google Calendar** —— Phase 3 全程只讀

## Capabilities

### New Capabilities

- `calendar-sync`: 定時從 Google Calendar 同步到 Supabase 的行為規格 —— 排程、窗口、增量寫入、取消偵測、清理邊界、Day 派生、失敗處理

### Modified Capabilities

（無 —— `calendar-events` / `sync-status` / `task-management` 的資料模型規格不變，本 change 只新增「寫入者」的行為。）

## Impact

- n8n：新增 1 個 workflow（2 條 schedule 分支 + 共用子流程），workflow JSON 需版控至 repo（`n8n/workflows/`）
- Supabase：`events` / `cycle_days` / `system_meta` 三表開始有資料；schema 不變
- 前端：無需改動（已按 spec 讀取）
- 憑證：**work 已於 2026-11-27 改為 readonly**（新 credential `GCalWorkRO000001`，type `googleOAuth2Api`，scope = `https://www.googleapis.com/auth/calendar.readonly`；實測寫入回 HTTP 403）。personal 維持讀寫（自己的日曆）
- **work 分支的讀取必須用 HTTP Request node**（`googleOAuth2Api` 唔係 Google Calendar node 的原生 credential type）；personal 分支可用 Google Calendar node
- 成本：每日 48 次執行、480 次 Google API call、每日 WAL <2 MB
