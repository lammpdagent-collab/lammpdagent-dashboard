# task-management Specification

## Purpose
TBD - created by archiving change add-command-center-schema. Update Purpose after archive.
## Requirements
### Requirement: 任務具備完整資料模型

系統 SHALL 在 `public.tasks` 提供以下欄位，並在資料庫層施加對應約束：

- `id` UUID 主鍵，預設 `gen_random_uuid()`
- `title` TEXT NOT NULL，且去除首尾空白後長度必須大於 0
- `notes` TEXT NOT NULL 預設 `''`（存 markdown 原文）
- `due_date` DATE，可為 NULL（代表冇截止日）
- `priority` TEXT NOT NULL 預設 `medium`，只允許 `critical` / `high` / `medium` / `low`
- `category` TEXT NOT NULL 預設 `work`，只允許 `work` / `personal` / `other`
- `status` TEXT NOT NULL 預設 `todo`，只允許 `todo` / `done` / `park`
- `pinned` BOOLEAN NOT NULL 預設 `false`
- `tags` TEXT[] NOT NULL 預設空陣列
- `source` TEXT NOT NULL，只允許 `telegram` / `web`
- `source_ref` TEXT，可為 NULL
- `created_at` / `updated_at` TIMESTAMPTZ NOT NULL 預設 `now()`
- `completed_at` / `deleted_at` TIMESTAMPTZ，可為 NULL

#### Scenario: 只提供 title 即可建立任務

- **WHEN** 插入一筆只有 `title` 的任務
- **THEN** 寫入成功，且 `priority='medium'`、`status='todo'`、`category='work'`、`pinned=false`、`tags='{}'`、`notes=''`

#### Scenario: 拒絕純空白的標題

- **WHEN** 插入 `title` 為空字串或只有空白的任務
- **THEN** 資料庫拒絕寫入

#### Scenario: 拒絕非法 priority

- **WHEN** 插入 `priority='urgent'` 的任務
- **THEN** 資料庫拒絕寫入

### Requirement: 任務狀態為三態且 park 不等於完成

系統 SHALL 只允許 `status` 為 `todo`、`done`、`park`。`park` 代表任務暫時等緊人／等外部，語義上仍然未完成。

#### Scenario: park 的任務不被計為完成

- **WHEN** 一個任務的 `status='park'`
- **THEN** 它不出現在「已完成」的計數或列表中，並應在待辦區域顯示為等待中

#### Scenario: 標記完成時自動記錄時間

- **WHEN** 任務由 `todo` 改為 `done` 而 `completed_at` 為 NULL
- **THEN** `completed_at` 自動設為現在時間

### Requirement: 任務修改時間由資料庫自動維護

系統 SHALL 在每次 UPDATE `tasks` 時自動更新 `updated_at`，不依賴任何客戶端或同步程式寫入。

#### Scenario: 任何寫入路徑都更新時間

- **WHEN** 任何角色（前端 owner session、service_role、或直接在 SQL Editor）對一筆任務執行 UPDATE
- **THEN** 該筆任務的 `updated_at` 等於該次 UPDATE 的時間

#### Scenario: INSERT 不觸發為錯誤值

- **WHEN** 插入一筆新任務而冇提供 `updated_at`
- **THEN** `updated_at` 等於 `created_at`（同為寫入時間）

### Requirement: 任務採用軟刪除且前端無實體刪除權限

系統 SHALL 以 `deleted_at` 表達刪除。持有 owner session 的前端 SHALL 冇權對 `tasks` 執行 DELETE。

#### Scenario: 前端嘗試實體刪除被拒

- **WHEN** 以 owner session 對 `tasks` 發出 DELETE
- **THEN** 資料庫拒絕，回傳權限錯誤

#### Scenario: 軟刪除後不再出現在一般查詢

- **WHEN** 一筆任務的 `deleted_at` 被設為現在時間
- **THEN** 以 `deleted_at IS NULL` 為條件的查詢不會返回該任務

#### Scenario: 軟刪除的任務仍可被查回

- **WHEN** 查詢時不篩選 `deleted_at`
- **THEN** 該任務仍然存在，`deleted_at` 有值

### Requirement: 任務只限單一 owner 存取

`tasks` SHALL 啟用 RLS，所有讀寫只限 JWT `email` 等於指定 owner 的 session。未登入的 anon 請求 SHALL 讀不到任何行。

#### Scenario: 非 owner 登入讀不到任務

- **WHEN** 以一個非 owner email 的已登入 session 查詢 `tasks`
- **THEN** 返回 0 行

#### Scenario: 未登入讀不到任務

- **WHEN** 以 anon key（無 session）查詢 `tasks`
- **THEN** 返回 0 行

#### Scenario: 非 owner 不能寫入

- **WHEN** 以非 owner email 的 session 嘗試 INSERT 任務
- **THEN** 資料庫拒絕

### Requirement: source_ref 防止同一來源重複寫入

`source_ref` SHALL 在有值時具唯一性，格式為 `tg-{chat_id}-{message_id}-{n}`（`n` 為該訊息內第幾個項目）。`source_ref` 為 NULL 的任務不受唯一性限制。

#### Scenario: 同一訊息重送被擋

- **WHEN** 插入第二筆 `source_ref` 與既有任務完全相同的記錄
- **THEN** 資料庫拒絕，且呼叫端以「略過」而非「失敗」處理

#### Scenario: 一句話拆多個任務可以共存

- **WHEN** 同一訊息產生兩個任務，`source_ref` 分別為 `tg-1-100-1` 與 `tg-1-100-2`
- **THEN** 兩筆都成功寫入

#### Scenario: 網頁手動新增多筆 NULL 不受限制

- **WHEN** 連續插入三筆 `source_ref` 為 NULL 的任務
- **THEN** 三筆全部成功

### Requirement: 已完成任務永久保留

系統 SHALL 保留所有已完成的任務，不設自動刪除期限。查詢端負責只顯示近期完成的任務。

#### Scenario: 一年前的完成任務仍然存在

- **WHEN** 查詢 `status='done'` 而唔設時間條件
- **THEN** 一年前完成的任務仍然返回

#### Scenario: 前端只顯示近期完成

- **WHEN** 前端顯示已完成區域
- **THEN** 它自行以 `completed_at` 篩選近期（例如最近 7 日），而非依賴資料庫刪除

