# capture-dual-write Specification

## Purpose
TBD - created by archiving change add-daily-briefing. Update Purpose after archive.
## Requirements
### Requirement: Capture 優先寫入 Supabase

Hermes 收到 capture（`capture` prefix 或意圖判斷為「記低」）時，SHALL **先**寫入 Supabase，成功後才進行 vault 寫入。

分類到 `tasks` 或 `events` 的判斷沿用 `SOUL.md` 現有規則（任務 vs 事件 vs 收件箱），但落地目標改為 Supabase。

#### Scenario: 任務類 capture
- **WHEN** 收到「capture 星期五前交 report」
- **THEN** 先 `POST /rest/v1/tasks`（`title`、`due_date`、`category`、`priority`、`source='telegram'`），成功後才處理 vault

#### Scenario: 事件類 capture
- **WHEN** 收到「capture 9月1號 10點 開會」
- **THEN** 先 `POST /rest/v1/events`，成功後才處理 vault

#### Scenario: Supabase 寫入失敗
- **WHEN** `POST /rest/v1/tasks` 回 4xx/5xx 或連線失敗
- **THEN** 唔進行 vault 寫入，直接向 Dickson 報告失敗原因（fail loud）

### Requirement: Supabase 成功即回覆

Supabase 寫入成功後，Hermes SHALL 立即向 Dickson 回覆確認訊息，**唔等** vault 寫入完成。

回覆格式沿用現有：「✅ 已記低」。

#### Scenario: 回覆時序
- **WHEN** Supabase POST 成功
- **THEN** 確認訊息在 vault 寫入開始前已發出

#### Scenario: 回覆內容
- **WHEN** 一項任務寫入成功
- **THEN** 回覆包含「✅ 已記低」，可以附一句任務標題

### Requirement: Vault 寫入由 subagent 執行

Supabase 寫入成功後，Hermes SHALL 以 `delegate_task` 開 subagent 執行 vault 寫入，按 `SOUL.md` 的舊規則（分類、`任務/` 詳情檔、`🔗` link、auto-match）。

Subagent 的 context SHALL 包含：
- 原始 capture 文字
- 已寫入 Supabase 的記錄 id 與分類結果
- vault 根路徑

#### Scenario: Subagent 成功
- **WHEN** subagent 完成 vault 寫入
- **THEN** 唔需要額外通知 Dickson（Supabase 已回覆）

#### Scenario: Subagent 失敗
- **WHEN** subagent 回報寫入失敗（檔案權限、路徑唔存在、內容衝突）
- **THEN** Hermes 發一句「⚠️ vault 寫入失敗（Supabase 已 OK）：<原因>」

#### Scenario: Subagent 唔改 Supabase
- **WHEN** subagent 執行中
- **THEN** 佢 SHALL NOT 再寫 Supabase（避免重複寫入或覆蓋）

### Requirement: Vault 角色限定為觀察標本

Vault SHALL NOT 作為任何新系統功能的資料源。具體：

- `briefing/fetch` CLI SHALL NOT 讀 vault
- `daily-briefing` skill 的資料讀取 SHALL NOT 讀 vault
- Dashboard SHALL NOT 讀 vault

Vault 只由 capture 的 subagent 寫入，供 Dickson 觀察至學年尾。

#### Scenario: Briefing 唔讀 vault
- **WHEN** briefing 產生
- **THEN** 所有資料來自 Supabase（`events`、`tasks`、`cycle_days`、`system_meta`）

#### Scenario: Vault 停止更新唔影響 briefing
- **WHEN** vault 停止寫入（例如 Dickson 手動停用 subagent）
- **THEN** briefing 照常運作

### Requirement: Dual write 一致性記錄

Hermes SHALL 在 Supabase 記錄中標示 `source = 'telegram'`，令日後可以追溯哪些記錄來自 capture。

#### Scenario: 來源標記
- **WHEN** capture 寫入 `tasks`
- **THEN** 該行 `source = 'telegram'`

#### Scenario: Dashboard 寫入的任務
- **WHEN** Dickson 在 dashboard 新增任務
- **THEN** 該行 `source = 'web'`（由 dashboard 現有邏輯設定）

