# ad-hoc-query Specification

## Purpose
TBD - created by archiving change add-daily-briefing. Update Purpose after archive.
## Requirements
### Requirement: 被動查詢走 Supabase

Hermes 回答 Dickson 的查詢（例如「我下禮拜有咩做」、「老陳份嘢幾時到期」）時 SHALL 查詢 Supabase，**SHALL NOT** 讀取 Obsidian vault。

理由：Phase 4 之後 vault 只由 capture 的 subagent 寫入，可能落後於 Supabase；查 vault 會答過期資料。

#### Scenario: 查未來日程
- **WHEN** Dickson 問「我下禮拜有咩做」
- **THEN** Hermes 查 `events`（下週日期範圍、`cancelled_at IS NULL`），唔讀 `事件.md`

#### Scenario: 查任務到期日
- **WHEN** Dickson 問「老陳份嘢幾時到期」
- **THEN** Hermes 查 `tasks`（`title` 模糊匹配、`status = 'todo'`），回報 `due_date`

#### Scenario: vault 有但 Supabase 冇
- **WHEN** vault 有某項記錄但 Supabase 冇對應行
- **THEN** Hermes SHALL NOT 回報該項（vault 唔再係資料源）

### Requirement: 查詢用同一資料層

被動查詢 SHALL 透過 `briefing/fetch` CLI 提供的查詢函數（或 `--mode query`）存取 Supabase，唔另寫一套連線邏輯。

理由：統一時間窗計算（HKT 邊界）、統一 `and=(...)` 參數組法（避免 Phase 3 的同名 parameter 陷阱）、統一錯誤處理。

#### Scenario: 重用時間窗計算
- **WHEN** 查詢指定「下禮拜」
- **THEN** 時間窗由 `briefing/fetch` 的 HKT 邊界函數計算，唔由 LLM 自行推算

#### Scenario: 連線失敗
- **WHEN** Supabase 無法連線
- **THEN** Hermes 回報「查詢失敗：<原因>」，唔作答案

### Requirement: 查詢模式 JSON 契約

`briefing/fetch --mode query` SHALL 輸出：

```
{
  "generated_at": "<ISO 8601 with +08:00>",
  "range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "sync": { "stale": bool, "reason": string|null, "sources": [ { "key": string, "last_run_at": string|null, "status": string|null } ] },
  "events": [ <event>... ],
  "tasks": [ <task>... ]
}
```

`events` SHALL 只含 `start_time` 落在 `[from 00:00 HKT, to+1日 00:00 HKT)` 且 `cancelled_at IS NULL` 的行。

`sync.sources` SHALL 按 `calendar_sync:personal`、`calendar_sync:work` 的固定次序輸出；`system_meta` 缺該 key 時，該項唔出現（唔輸出 null 佔位）。

`events` SHALL 套用與 briefing 相同的跨帳號去重規則（title `trim()` 相同 且 start_time 同一分鐘 → 保留 `work`，只有 personal 則保留）。

`tasks` SHALL NOT 按 `due_date` 過濾 —— 全量 `status='todo'` 且 `deleted_at IS NULL` 的任務都要輸出（查詢「某任務幾時到期」時需要跨 range 查找）。

#### Scenario: events 按 range 過濾
- **WHEN** `--from 2026-12-01 --to 2026-12-31`
- **THEN** `events` 只含 12 月的事件（`to` 為含尾日，即到 12-31 23:59 HKT）

#### Scenario: query 結果去重
- **WHEN** 同一事件在 work 與 personal 都有，且落在 query range 內
- **THEN** `events` 只保留 work 的一行

#### Scenario: tasks 唔受 range 限制
- **WHEN** `--from 2026-12-01 --to 2026-12-31`，而有一個任務 `due_date = 2027-03-15`
- **THEN** 該任務仍然出現在 `tasks` 陣列

#### Scenario: 空結果唔係 null
- **WHEN** range 內零事件
- **THEN** `events` 為空陣列（唔係 null）

### Requirement: 查詢範圍彈性

`briefing/fetch` SHALL 支援 `--mode query --from YYYY-MM-DD --to YYYY-MM-DD`，輸出該範圍的 events（含相關性標記）與 tasks。

查詢範圍 SHALL NOT 受限於 briefing 的固定窗口（今日 / 未來 7 日 / 未來 2 日）。

#### Scenario: 查過去日期
- **WHEN** 查詢 `--from 2026-11-01 --to 2026-11-30`
- **THEN** 輸出該月所有 `cancelled_at IS NULL` 的事件

#### Scenario: 查遠期
- **WHEN** 查詢 `--from 2027-01-01 --to 2027-03-31`
- **THEN** 輸出該季事件（唔受 briefing 的 7 日窗口限制）

#### Scenario: 範圍過大
- **WHEN** 查詢範圍超過 366 日
- **THEN** `briefing/fetch` 回非零 exit 並提示縮窄範圍（防止拉全表）

