## ADDED Requirements

### Requirement: tag 目錄為獨立於任務的資料表

系統 SHALL 在 `public.tags` 提供一個獨立於 `tasks.tags` 的 tag 目錄，使 tag 可以在未被任何任務使用的前提下存在。

- `name` TEXT 主鍵，去除首尾空白後長度必須介乎 1 至 40
- `created_at` TIMESTAMPTZ NOT NULL 預設 `now()`
- 不設 `id` 欄位 —— `name` 本身即自然主鍵，重複新增同一 tag 不應產生第二行

#### Scenario: 新增一個未被任何任務使用的 tag

- **WHEN** 插入 `name='體育科'`，而 `tasks` 中無任何任務的 `tags` 含此值
- **THEN** 寫入成功，且該 tag 出現在前端可選清單

#### Scenario: 拒絕空白或過長的 tag

- **WHEN** 插入 `name='   '` 或長度 41 的名稱
- **THEN** 資料庫拒絕寫入

#### Scenario: 重複新增同一 tag 不報錯

- **WHEN** 以 `ON CONFLICT DO NOTHING` 再次插入已存在的 `name`
- **THEN** 不產生新行，且不拋出錯誤

### Requirement: 移除使用中的 tag 必須先確認並批量清理

系統 SHALL 在移除一個正被任務使用的 tag 時，先要求使用者確認，確認後在同一次操作中從所有任務的 `tags` 陣列移除該值，並刪除目錄中的該行。

#### Scenario: 移除未被使用的 tag

- **WHEN** 移除 `name='舊標籤'`，而無任何任務使用它
- **THEN** 直接刪除目錄中的該行，無需確認

#### Scenario: 移除正被 3 個任務使用的 tag

- **WHEN** 使用者確認移除 `name='學教組'`，且 3 個任務的 `tags` 含此值
- **THEN** 該 3 個任務的 `tags` 都不再含 `學教組`，且目錄中該行被刪除

#### Scenario: 使用者取消移除

- **WHEN** 使用者在確認對話中選擇取消
- **THEN** 目錄與所有任務的 `tags` 完全不變

### Requirement: tag 目錄只限單一 owner 讀寫

系統 SHALL 以 RLS 限制 `public.tags` 只容許 owner email 的 `authenticated` 角色讀取、新增、刪除；`anon` 不得有任何權限。

#### Scenario: anon 無法讀取 tag 目錄

- **WHEN** 以 anon key 查詢 `public.tags`
- **THEN** 回傳權限錯誤（HTTP 401 / 42501），而非空結果集

#### Scenario: 非 owner 帳號無法新增 tag

- **WHEN** 以非 owner 的 authenticated 身分插入 `name='測試'`
- **THEN** 資料庫拒絕寫入（RLS 擋下）

#### Scenario: owner 可以新增與刪除

- **WHEN** 以 owner 身分插入再刪除同一 `name`
- **THEN** 兩次操作都成功
