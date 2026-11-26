# calendar-events Specification

## Purpose
TBD - created by archiving change add-command-center-schema. Update Purpose after archive.
## Requirements
### Requirement: 事件具備完整資料模型並以複合 id 保證冪等

系統 SHALL 在 `public.events` 提供以下欄位：

- `id` TEXT 主鍵，格式為 `{account_key}_{google_event_id}`
- `google_event_id` TEXT NOT NULL
- `title` TEXT NOT NULL 預設 `''`
- `description` TEXT NOT NULL 預設 `''`
- `start_time` / `end_time` TIMESTAMPTZ NOT NULL（存 UTC）
- `is_all_day` BOOLEAN NOT NULL 預設 `false`
- `location` TEXT NOT NULL 預設 `''`
- `account_key` TEXT NOT NULL，只允許 `personal` / `work`
- `source_calendar` TEXT，可為 NULL
- `relevance` TEXT NOT NULL 預設 `context`，只允許 `linked` / `context` / `noise`
- `day_cycle` TEXT，可為 NULL
- `series_id` TEXT，可為 NULL
- `recurrence_note` TEXT，可為 NULL
- `cancelled_at` TIMESTAMPTZ，可為 NULL
- `calendar_status` TEXT NOT NULL 預設 `confirmed`
- `last_synced_at` TIMESTAMPTZ NOT NULL 預設 `now()`

#### Scenario: 同一 Google 事件重複 upsert 唔會產生兩行

- **WHEN** 以相同 `account_key` 與 `google_event_id` 連續兩次寫入
- **THEN** 資料表只有一行，內容為第二次的值

#### Scenario: 兩個帳號的同名事件可以共存

- **WHEN** 私人與學校帳號各有一個 `google_event_id` 相同的活動
- **THEN** 因為 `account_key` 不同，兩行都成功寫入

#### Scenario: 拒絕非法 account_key

- **WHEN** 寫入 `account_key='school'`
- **THEN** 資料庫拒絕

### Requirement: 事件取消以標記表達而非刪除

當 Google Calendar 上一個事件被取消或刪除，系統 SHALL 設定 `cancelled_at`，SHALL NOT 直接刪除該行。

#### Scenario: 同步發現事件已取消

- **WHEN** 某事件在本次同步中唔再出現於 Google Calendar
- **THEN** 該行的 `cancelled_at` 被設為現在時間，行本身保留

#### Scenario: 已取消事件不在一般顯示

- **WHEN** 前端查詢事件而唔包括 `cancelled_at IS NOT NULL`
- **THEN** 該事件不出現

#### Scenario: 已取消事件仍可追溯

- **WHEN** 查詢時包括 `cancelled_at IS NOT NULL` 的行
- **THEN** 可以看到該事件及其取消時間

### Requirement: 事件歷史永久保留

系統 SHALL NOT 因時間過去而自動刪除 `events`。同步只更新或標記，不執行過期清理。

#### Scenario: 一年前的事件仍然存在

- **WHEN** 一個事件已結束超過一年
- **THEN** 該行仍然存在於資料表

#### Scenario: 前端自行限制顯示範圍

- **WHEN** 前端顯示日程
- **THEN** 它自行以 `end_time` 篩選（例如 Today / Tomorrow / Upcoming），而非依賴資料庫刪除

### Requirement: 事件只讀，寫入只限 service_role

`events` SHALL 啟用 RLS。持有 owner session 的前端只可以 SELECT，SHALL NOT 可以 INSERT / UPDATE / DELETE。寫入只由 service_role（n8n 同步）執行。

#### Scenario: owner session 嘗試修改事件被拒

- **WHEN** 以 owner session 對 `events` 執行 UPDATE 或 DELETE
- **THEN** 資料庫拒絕

#### Scenario: 非 owner 讀不到事件

- **WHEN** 以非 owner email 的 session 或 anon key 查詢 `events`
- **THEN** 返回 0 行

#### Scenario: service_role 可以寫入

- **WHEN** 以 service_role key 執行 upsert
- **THEN** 寫入成功（不受 RLS 限制）

### Requirement: 事件變更可即時推送完整行

`events` SHALL 設定 `REPLICA IDENTITY FULL`，確保 UPDATE / DELETE 的複寫訊息包含完整舊值。

#### Scenario: 帶 filter 的訂閱仍然收到刪除事件

- **WHEN** 前端以 `account_key=eq.work` 為 filter 訂閱 `events`，而該帳號的一個事件被刪除
- **THEN** 前端收到該刪除通知（因為複寫訊息包含 `account_key`）

#### Scenario: 三張表都在 realtime publication

- **WHEN** 查詢 `pg_publication_tables` 而 `pubname='supabase_realtime'`
- **THEN** `tasks`、`events`、`system_meta` 三者都在列表

### Requirement: Realtime 設定可重複執行

將表加入 publication 的 migration SHALL 具冪等性：重複執行不會報錯，亦不會破壞既有設定。

#### Scenario: 重複執行加入 publication 的語句

- **WHEN** 對已在 publication 的 `events` 再次執行加入語句
- **THEN** 不報錯，publication 內容不變

