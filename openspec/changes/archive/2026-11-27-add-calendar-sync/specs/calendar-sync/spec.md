## ADDED Requirements

### Requirement: 同步以雙層排程執行

同步 SHALL 以兩個獨立的定時觸發執行：整點觸發抓取未來 90 天，半點觸發抓取未來 30 天。兩者都包含過去 1 天。

#### Scenario: 整點觸發抓 90 天
- **WHEN** 系統時鐘到達整點（`0 * * * *`）
- **THEN** n8n SHALL 抓取 `timeMin = now - 1d`、`timeMax = now + 90d` 的事件
- **AND** 寫入 `public.events`

#### Scenario: 半點觸發抓 30 天
- **WHEN** 系統時鐘到達半點（`30 * * * *`）
- **THEN** n8n SHALL 抓取 `timeMin = now - 1d`、`timeMax = now + 30d` 的事件

#### Scenario: 兩個排程不互相破壞
- **WHEN** 半點排程在 30 天窗口內完成清理
- **THEN** 30–90 天之間的事件 SHALL 維持不變
- **AND** 其 `last_synced_at` 保持上一次整點執行的時間

### Requirement: 清理只在本次抓取窗口內生效

清理（把 Google 已不存在的事件標記 `cancelled_at`）SHALL 同時受 `account_key`、`start_time >= window_start`、`start_time < window_end`、`last_synced_at < batch_time` 四個條件限制。

#### Scenario: 半點同步不刪除 30 天以外的事件
- **WHEN** 半點排程跑完 30 天窗口
- **THEN** 任何 `start_time >= now + 30d` 的事件 SHALL 不被清理
- **AND** 其 `cancelled_at` 保持 NULL

#### Scenario: 窗口內的失蹤事件被標記
- **WHEN** 某事件在 Google 已被刪除，且其 `start_time` 在本次窗口內
- **THEN** 該事件 SHALL 被標記 `cancelled_at = batch_time`
- **AND** 該行 SHALL 不被實體刪除

#### Scenario: 未變更的事件不被誤標取消
- **WHEN** 連續兩次同步之間，某事件在 Google 完全冇變更
- **THEN** 該事件的 `cancelled_at` SHALL 保持 NULL
- **AND** 即使其 `last_synced_at` 停留在上一次的 batch 時間，亦不得被判為 stale

#### Scenario: 曾被誤標的事件在 Google 重現時自癒
- **WHEN** 某事件已有 `cancelled_at`，但其後在 Google 抓取結果中重新出現
- **THEN** 該事件 SHALL 被 UPDATE，且 `cancelled_at` SHALL 重設為 NULL

#### Scenario: 一個帳號失敗不影響另一個
- **WHEN** personal 帳號的抓取失敗
- **THEN** work 帳號的清理 SHALL 照常執行
- **AND** personal 的既有事件 SHALL 不被清理

### Requirement: 增量寫入只處理有變更的事件

同步 SHALL 比對 Google 回應的 `updated` 與 DB 既有的 `last_synced_at`，只對新建或有變更的事件執行寫入。

#### Scenario: 穩定狀態下不重寫未變更行
- **WHEN** 連續兩次同步之間沒有任何事件變更
- **THEN** 第二次同步 SHALL 寫入 0 行
- **AND** 不產生新的 row version

#### Scenario: 新事件被插入
- **WHEN** Google 出現一個 DB 沒有的 `id`
- **THEN** 該事件 SHALL 以 INSERT 寫入
- **AND** `last_synced_at` SHALL 等於本次 `batch_time`

#### Scenario: 修改過的事件被更新
- **WHEN** Google 事件的 `updated` 晚於 DB 的 `last_synced_at`
- **THEN** 該行 SHALL 被 UPDATE
- **AND** `last_synced_at` 更新為本次 `batch_time`

### Requirement: 只讀單一日曆的事件，skip 教師生日

同步 SHALL 讀取 personal 帳號全部 3 個日曆、work 帳號 6 個日曆（7 個之中排除 `5. 教師生日`）。

#### Scenario: 教師生日不被寫入
- **WHEN** 日曆清單包含 summary 為 `5. 教師生日` 的日曆
- **THEN** 該日曆 SHALL 被跳過
- **AND** 其事件不出現在 `public.events`

#### Scenario: 空日曆照樣讀取
- **WHEN** 某日曆在窗口內有 0 個事件
- **THEN** 同步 SHALL 正常完成，不報錯
- **AND** 該日曆不產生任何寫入

### Requirement: 循環日由 work 的 Day event 派生

`cycle_days` SHALL 由 work 帳號「2. 學生相關」日曆中標題符合 Day 模式的事件派生，並支援全形與半形字母。

#### Scenario: 全形字母被正確識別
- **WHEN** 事件標題為 `DayＥ`（全形 Ｅ，U+FF25）
- **THEN** SHALL 寫入 `cycle_days(date = 事件日期, day_label = 'E')`

#### Scenario: 半形字母被正確識別
- **WHEN** 事件標題為 `Day E（第9循環週）`
- **THEN** SHALL 寫入 `cycle_days(date = 事件日期, day_label = 'E')`

#### Scenario: 非 Day 事件不寫入 cycle_days
- **WHEN** 事件標題為 `校際朗誦節比賽時段`
- **THEN** `cycle_days` SHALL 不產生對應行
- **AND** 該事件仍寫入 `public.events`

#### Scenario: 90 天內 Day 記錄不少於 42 筆
- **WHEN** 首次 backfill 完成
- **THEN** `select count(*) from cycle_days where date between now and now+90d` SHALL >= 42

### Requirement: 首次同步回填自學年開始

首次執行（backfill）SHALL 抓取由 2026-08-01 起至未來 90 天的事件，而非僅按常規窗口。

#### Scenario: backfill 覆蓋整個學年至今
- **WHEN** 手動觸發 backfill
- **THEN** `timeMin` SHALL 為 `2026-08-01T00:00:00Z`
- **AND** `timeMax` SHALL 為 `now + 90d`
- **AND** 寫入行數 SHALL 約為 1,500 以上

#### Scenario: backfill 後恢復常規排程
- **WHEN** backfill 完成
- **THEN** 後續執行 SHALL 按 D1 的雙層窗口
- **AND** 不會重複 backfill

### Requirement: 同步失敗記錄狀態但不重試

同步失敗 SHALL 寫入 `system_meta`（`status='error'`、`detail` 含錯誤訊息、`last_run_at`），且不執行即時重試。

#### Scenario: Google API 失敗
- **WHEN** Google Calendar API 回傳非 2xx
- **THEN** `system_meta` 對應帳號行 SHALL 更新 `status='error'`
- **AND** `detail` SHALL 包含 HTTP 狀態與訊息
- **AND** 不執行 retry

#### Scenario: Supabase 寫入失敗
- **WHEN** 寫入 `events` 失敗
- **THEN** 同一帳號的清理 SHALL 不執行
- **AND** `system_meta` SHALL 記錄錯誤

#### Scenario: 成功時更新狀態
- **WHEN** 同步成功完成
- **THEN** `system_meta.status` SHALL 為 `'ok'`
- **AND** `last_run_at` SHALL 為本次 `batch_time`
- **AND** `detail` SHALL 記錄本次抓取數量

### Requirement: 同步不寫入 Google Calendar

Phase 3 的同步 SHALL 只使用 Google Calendar 的讀取 operation，任何寫入 operation 都不得出現在 workflow 中。

#### Scenario: workflow 內無 write operation
- **WHEN** 檢視 workflow JSON
- **THEN** 所有 Google Calendar node 的 `operation` SHALL 為 `getAll` 或 `get`
- **AND** 不存在 `create` / `update` / `delete`

#### Scenario: work credential 的使用限於讀取
- **WHEN** work 分支執行
- **THEN** 只呼叫 `events.list` 與 `calendarList.list`

#### Scenario: work credential 在 Google 層面已限於只讀
- **WHEN** 用 work credential（`GCalWorkRO000001`，scope `calendar.readonly`）嘗試任何寫入 operation
- **THEN** Google API SHALL 回 HTTP 403 `insufficient authentication scopes`
- **AND** 學校日曆 SHALL 不被修改

#### Scenario: personal 與 work 用不同的 credential type
- **WHEN** 檢視 workflow JSON
- **THEN** personal 分支的 Google 節點 SHALL 綁 `googleCalendarOAuth2Api` credential `Krkcl8tNeQi3eQkX`
- **AND** work 分支的 HTTP Request 節點 SHALL 綁 `googleOAuth2Api` credential `GCalWorkRO000001`
