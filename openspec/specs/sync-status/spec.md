# sync-status Specification

## Purpose
TBD - created by archiving change add-command-center-schema. Update Purpose after archive.
## Requirements
### Requirement: 每個同步來源各自一行狀態

`system_meta` SHALL 以每個同步來源一行記錄狀態，`key` 格式為 `calendar_sync:{account_key}`（例如 `calendar_sync:personal`、`calendar_sync:work`）。SHALL NOT 以單一行同時代表多個來源。

#### Scenario: 兩個帳號各自有狀態行

- **WHEN** 私人與學校帳號各完成一次同步
- **THEN** `system_meta` 有兩行：`calendar_sync:personal` 與 `calendar_sync:work`

#### Scenario: 一個帳號失敗不影響另一個的狀態

- **WHEN** 私人同步成功而學校同步失敗
- **THEN** `calendar_sync:personal` 的 `status='ok'`，`calendar_sync:work` 的 `status='error'`，兩者互不覆蓋

### Requirement: 狀態值具固定語義

`system_meta.status` SHALL 只允許 `ok`、`error`、`init`、`stale`。

- `init`：從未成功同步過
- `ok`：最近一次同步成功
- `error`：最近一次同步失敗
- `stale`：超過預期時間未同步（由讀取端判斷，非寫入端）

#### Scenario: 首次建立時為 init

- **WHEN** 一個來源第一次被建立而從未同步
- **THEN** `status='init'` 且 `last_run_at` 為該建立時間

#### Scenario: 同步失敗保留錯誤訊息

- **WHEN** 學校帳號同步因 token 過期失敗
- **THEN** `status='error'`，`message` 包含可辨識的錯誤原因（例如 `invalid_grant`）

### Requirement: 狀態行攜帶同步細節供清理邏輯判斷

`system_meta.detail` SHALL 為 JSONB，最少可以承載 `fetched`（本次抓取的事件數量）與 `prev_fetched`（上一次的數量）。

#### Scenario: 記錄本次抓取數量

- **WHEN** 一次同步抓到 12 個事件
- **THEN** 該帳號的 `detail` 包含 `{"fetched": 12}`

#### Scenario: 抓 0 筆時可以識破異常

- **WHEN** 一次同步抓到 0 個事件而上一次為 17
- **THEN** 讀取端可以由 `detail` 判斷這是異常而非真實清空

### Requirement: 同步狀態只讀

`system_meta` SHALL 啟用 RLS。持有 owner session 的前端只可以 SELECT；寫入只由 service_role 執行。

#### Scenario: 前端不能改寫同步狀態

- **WHEN** 以 owner session 對 `system_meta` 執行 INSERT 或 UPDATE
- **THEN** 資料庫拒絕

#### Scenario: 非 owner 讀不到

- **WHEN** 以非 owner email 的 session 或 anon key 查詢 `system_meta`
- **THEN** 返回 0 行

### Requirement: 前端可以判斷資料新鮮度

前端 SHALL 可以由 `system_meta.last_run_at` 顯示每個來源的更新時間，並在超過 24 小時時提示資料可能過期。

#### Scenario: 顯示更新於多久之前

- **WHEN** 前端讀取 `system_meta`
- **THEN** 每個來源顯示「N 分鐘前更新」

#### Scenario: 超過一日顯示警告

- **WHEN** `last_run_at` 距今超過 24 小時
- **THEN** 前端顯示資料可能過期的警告

