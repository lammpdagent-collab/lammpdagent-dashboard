# guestbook Specification

## Purpose
規範訪客留言板的功能行為：暱稱＋內容的提交與驗證、最新 3 條留言的顯示、資料持久化，以及匿名（anon）角色在 RLS 下只可讀取與新增、不可修改或刪除。
## Requirements
### Requirement: 訪客可以提交留言

系統 SHALL 提供一個表單，包含「暱稱」同「內容」兩個輸入欄位，訪客填妥後可以提交留言。

- 暱稱：去除前後空白後，長度 MUST 為 1 至 30 個 Unicode code point
- 內容：去除前後空白後，長度 MUST 為 1 至 500 個 Unicode code point
- 儲存前 MUST 對兩個欄位做 trim

#### Scenario: 提交有效留言

- **WHEN** 訪客輸入暱稱「小明」同內容「你好」並提交
- **THEN** 系統將留言寫入資料庫，並喺留言列表顯示該留言

#### Scenario: 空白內容被拒絕

- **WHEN** 訪客只輸入空白（或留空）並提交
- **THEN** 系統 MUST NOT 寫入資料庫，並顯示指出哪個欄位不合法嘅錯誤訊息

#### Scenario: 超出長度上限被拒絕

- **WHEN** 暱稱超過 30 字或內容超過 500 字
- **THEN** 系統 MUST NOT 寫入資料庫，並顯示長度錯誤訊息

#### Scenario: 提交期間避免重複送出

- **WHEN** 訪客提交後、伺服器尚未回應
- **THEN** 提交按鈕 MUST 停用，直到該次請求結束

### Requirement: 訪客可以查看最近 3 條留言

系統 SHALL 喺頁面載入時顯示最近 3 條留言，按建立時間由新至舊排序，每條顯示暱稱、內容同建立時間。

#### Scenario: 載入現有留言

- **WHEN** 資料庫已有 3 條或以上留言，訪客開啟頁面
- **THEN** 頁面顯示最新 3 條，最新嘅喺最前

#### Scenario: 留言不足 3 條

- **WHEN** 資料庫只有 1 至 2 條留言
- **THEN** 頁面顯示全部現有留言，唔顯示空位或錯誤

#### Scenario: 完全沒有留言

- **WHEN** 資料庫冇任何留言
- **THEN** 頁面顯示「暫無留言」之類嘅空狀態提示，而唔係錯誤

#### Scenario: 提交成功後列表更新

- **WHEN** 訪客成功提交一條留言
- **THEN** 列表即時重新載入，新留言出現喺最前，輸入欄位清空

### Requirement: 留言永久保存

留言 MUST 儲存喺 Supabase Postgres，頁面重新載入或隔日重開仍然可見。

#### Scenario: 重新載入後留言仍在

- **WHEN** 訪客提交留言後重新載入頁面
- **THEN** 該留言仍然出現喺列表中

### Requirement: 留言讀寫權限受限

資料庫 MUST 透過 Row Level Security 限制匿名（anon）角色：只可以讀取同新增留言，不可以修改或刪除任何留言。

#### Scenario: 匿名讀取留言

- **WHEN** 未登入嘅瀏覽器用 anon key 查詢 `messages`
- **THEN** 查詢成功並回傳留言

#### Scenario: 匿名新增留言

- **WHEN** 未登入嘅瀏覽器用 anon key 插入一條符合長度限制嘅留言
- **THEN** 插入成功

#### Scenario: 匿名不能修改或刪除

- **WHEN** 未登入嘅瀏覽器用 anon key 對 `messages` 執行 UPDATE 或 DELETE
- **THEN** 操作被拒絕，資料不變

#### Scenario: 伺服器端同樣拒絕超長留言

- **WHEN** 有人繞過前端，直接向資料庫插入超過長度上限嘅留言
- **THEN** 資料庫 MUST 以約束（CHECK constraint）拒絕該筆寫入

### Requirement: 可透過公開網址使用

應用程式 MUST 以純靜態檔案部署喺 GitHub Pages，任何人可透過該網址使用，唔需要登入或本機環境。

#### Scenario: 從 GitHub Pages 開啟

- **WHEN** 任何人開啟 GitHub Pages 網址
- **THEN** 頁面正常載入（資源路徑正確，無 404），並顯示留言表單同最近 3 條留言

#### Scenario: 從公開網址提交留言

- **WHEN** 訪客喺 GitHub Pages 網址提交一條有效留言
- **THEN** 留言成功寫入並顯示，效果同本機 `npm run dev` 一致

