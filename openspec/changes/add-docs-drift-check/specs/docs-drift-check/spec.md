# Delta Spec: docs-drift-check

## ADDED Requirements

### Requirement: 文件漂移檢查命令

系統 SHALL 提供 `npm run docs:check` 命令，驗證 `SYSTEM.md §4`（Spec ↔ Runtime 對應表）所聲稱的關係在現實中仍然成立。

檢查 SHALL 以 `SYSTEM.md §4` 表格為唯一資料源，唔可以在 script 內另寫一份路徑清單（否則兩份清單會各自腐爛）。

#### Scenario: 全部一致
- **WHEN** 執行 `npm run docs:check` 且所有檢查項通過
- **THEN** 印出每個檢查項的 OK 狀態
- **THEN** exit code 為 0

#### Scenario: 有任何一項不一致
- **WHEN** 執行 `npm run docs:check` 且至少一項失敗
- **THEN** 印出失敗項目的「位置、期望、實際」
- **THEN** exit code 為 1

### Requirement: Spec 檔案存在性檢查

對於 `SYSTEM.md §4` 表格的每一行，系統 SHALL 驗證左欄所列的 spec 檔存在於 `openspec/specs/<capability>/spec.md`。

#### Scenario: spec 檔存在
- **WHEN** §4 某行寫 `specs/daily-briefing/spec.md`
- **THEN** 檢查 `openspec/specs/daily-briefing/spec.md` 存在，報告 OK

#### Scenario: spec 檔缺失
- **WHEN** §4 引用的 spec 檔在磁碟上唔存在
- **THEN** 報告該行號 + 期望路徑 + 「檔案不存在」
- **THEN** 整體 exit code 為 1

### Requirement: Runtime 路徑存在性檢查

對於 `SYSTEM.md §4` 表格的每一行，系統 SHALL 驗證右欄所列的 runtime 實作路徑在磁碟上存在。

L3（repo 內）路徑 SHALL 相對於 repo 根解析。
L4（Hermes profile）路徑 SHALL 相對於 `%LOCALAPPDATA%\hermes\profiles\` 解析（Linux/macOS 用 `~/.local/share/hermes/profiles/`）。

#### Scenario: repo 內檔案存在
- **WHEN** §4 某行寫 `briefing/fetch.ts`
- **THEN** 檢查 `<repo>/briefing/fetch.ts` 存在，報告 OK

#### Scenario: profile 內檔案存在
- **WHEN** §4 某行寫 `skills/daily-briefing/SKILL.md`（屬於 L4）
- **THEN** 檢查 `<profiles>/personal-assistant/skills/daily-briefing/SKILL.md` 存在，報告 OK

#### Scenario: runtime 檔案缺失
- **WHEN** §4 引用的 runtime 檔在磁碟上唔存在
- **THEN** 報告該行號 + 解析後的完整路徑 + 「檔案不存在」
- **THEN** 整體 exit code 為 1

### Requirement: Cron job 設定一致性檢查

系統 SHALL 驗證 `cron/jobs.json`（位於 personal-assistant profile）的每個 job：

- `skills` 陣列內每個名稱，對應一個存在的 skill 目錄
- `schedule.expr` 是合法的 5 欄位 cron 表達式

#### Scenario: skills 全部存在
- **WHEN** 某 job 的 `skills` 為 `["daily-briefing"]`
- **THEN** 檢查 skill 目錄存在，報告 OK

#### Scenario: skills 引用唔存在的 skill
- **WHEN** 某 job 的 `skills` 含 `obsidian`，但該 skill 目錄已被移動或改名
- **THEN** 報告 job id + job name + 「skills 引用唔存在的 skill: obsidian」
- **THEN** 整體 exit code 為 1

#### Scenario: cron 表達式格式錯
- **WHEN** 某 job 的 `schedule.expr` 唔係 5 欄位格式
- **THEN** 報告 job id + 實際值 + 「不是合法 cron 表達式」
- **THEN** 整體 exit code 為 1

### Requirement: n8n 快照一致性檢查（環境容許時）

當 `~/.n8n/database.sqlite` 可讀時，系統 SHALL 驗證 live workflow 與 `n8n/workflows/*.json` 快照的 `nodes` 及 `connections` 完全相同。

當 SQLite 檔唔存在或讀取失敗時，系統 SHALL 報告「跳過（環境沒有 n8n）」並**唔當作失敗**。

#### Scenario: hash 一致
- **WHEN** live nodes/connections 與快照相同
- **THEN** 報告兩個 hash，標記 OK

#### Scenario: hash 不一致
- **WHEN** live 與快照的 nodes 或 connections 有任何差異
- **THEN** 報告「live hash」「snapshot hash」及「DRIFT」
- **THEN** 整體 exit code 為 1

#### Scenario: 冇 n8n 環境
- **WHEN** `~/.n8n/database.sqlite` 唔存在
- **THEN** 報告「跳過（環境沒有 n8n）」
- **THEN** 唔影響 exit code

### Requirement: 輸出語言與格式

所有檢查輸出 SHALL 使用繁體中文，並在失敗時明確指出：

- 哪一個檢查項（spec 存在性 / runtime 存在性 / cron 一致性 / n8n 一致性）
- 哪一行（`SYSTEM.md §4` 的行號，或 job id）
- 期望什麼、實際什麼

#### Scenario: 失敗輸出的可讀性
- **WHEN** 任一檢查失敗
- **THEN** 輸出至少包含：檢查項名稱、位置標識、期望值、實際值
- **THEN** 唔可以只輸出「檢查失敗」而唔講邊一項

### Requirement: 格式契約（防靜默跳過）

若 `SYSTEM.md §4` 的表格格式與 parser 預期不符（例如表格不存在、欄位數唔對），系統 SHALL 明確報錯並 exit 1，**唔可以靜默回報 OK**。

#### Scenario: SYSTEM.md 冇 §4 表格
- **WHEN** `SYSTEM.md` 內搵唔到 `## 4.` 章節或表格
- **THEN** 報告「SYSTEM.md §4 格式唔符預期，無法檢查」
- **THEN** exit code 為 1

#### Scenario: 表格行欄位數唔對
- **WHEN** §4 表格某行唔係 3 欄（Spec / Runtime / 其他）
- **THEN** 報告該行內容 + 「欄位數唔符預期」
- **THEN** exit code 為 1
