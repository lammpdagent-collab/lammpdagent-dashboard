## ADDED Requirements

### Requirement: 校曆循環日以每日一行的對照表儲存

系統 SHALL 在 `public.cycle_days` 提供「日期 → 循環日標籤」的對照，每個日期最多一行。

- `date` DATE 主鍵
- `day_label` TEXT NOT NULL，只允許 `A` / `B` / `C` / `D` / `E` / `F`
- `updated_at` TIMESTAMPTZ NOT NULL 預設 `now()`，由 trigger 或 upsert 更新

#### Scenario: 寫入一日的循環日

- **WHEN** upsert `date='2026-11-26', day_label='A'`
- **THEN** 寫入成功，查詢該日回傳 `A`

#### Scenario: 同一日期重複 upsert 覆蓋舊值

- **WHEN** 已有 `2026-11-26 → 'A'`，再 upsert `2026-11-26 → 'B'`
- **THEN** 該日期仍只有一行，值為 `B`

#### Scenario: 拒絕非 A–F 的標籤

- **WHEN** 插入 `day_label='G'` 或 `day_label='Day A'`
- **THEN** 資料庫拒絕寫入

### Requirement: 循環日對照表由 n8n 寫入、前端只讀

系統 SHALL 只容許 `authenticated` 角色讀取 `public.cycle_days`；寫入必須經 `service_role`（n8n workflow）。前端不得具備 INSERT / UPDATE / DELETE 權限。

#### Scenario: 前端嘗試寫入被拒

- **WHEN** 以 owner 的 authenticated 身分 UPDATE `day_label`
- **THEN** 資料庫回傳 `permission denied`，不會靜默失敗

#### Scenario: service_role 可以寫入

- **WHEN** n8n 以 service_role upsert 一整學年的對照
- **THEN** 全部寫入成功

### Requirement: 前端查詢今日循環日

系統 SHALL 讓前端以當日日期查詢 `cycle_days`，取得 `day_label` 用於在介面頂部顯示「今日 Day X」。

#### Scenario: 今日存在對照記錄

- **WHEN** 前端查詢 `date = 今日`
- **THEN** 回傳 `day_label`，介面頂部顯示「今日 Day A」

#### Scenario: 今日為假期、無對照記錄

- **WHEN** 前端查詢 `date = 今日` 而無對應行
- **THEN** 介面頂部不顯示循環日，不顯示錯誤
