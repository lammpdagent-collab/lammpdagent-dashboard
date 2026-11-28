## ADDED Requirements

### Requirement: Briefing 資料新鮮度檢查

Briefing 查詢層 SHALL 讀取 `system_meta` 的 `calendar_sync:personal` 與 `calendar_sync:work` 兩筆記錄，並將每筆的 `key`、`last_run_at`（絕對時間，UTC ISO 8601）、`status` 一併輸出（`sync.sources`），令上游可判斷資料是否新鮮及追溯來源。

「新鮮」定義：`last_run_at` 距今 **超過** 26 小時才算 stale（26 小時整 = fresh）。覆蓋整點 90 天排程 + 半天寬限。

#### Scenario: 兩帳號皆新鮮
- **WHEN** 兩個 `calendar_sync:*` 記錄 `status = 'ok'` 且 `last_run_at` 距今 < 26 小時
- **THEN** 輸出的 `sync.stale` 為 `false`

#### Scenario: 任一帳號過期
- **WHEN** 任一 `calendar_sync:*` 記錄的 `last_run_at` 距今 **超過** 26 小時
- **THEN** 輸出的 `sync.stale` 為 `true`，且 `sync.reason` 指明哪個帳號過期及其 `last_run_at`

#### Scenario: 任一帳號上次失敗
- **WHEN** 任一 `calendar_sync:*` 記錄 `status = 'error'`
- **THEN** 輸出的 `sync.stale` 為 `true`，且 `sync.reason` 包含該記錄的 `message`

#### Scenario: system_meta 完全冇記錄
- **WHEN** `system_meta` 表冇任何 `calendar_sync:*` 記錄
- **THEN** 輸出的 `sync.stale` 為 `true`，`sync.reason` 為「從未同步」

### Requirement: 今日事件查詢

Briefing 查詢層 SHALL 輸出「今日」的事件集合，定義為 `start_time` 落在今日 HKT 00:00（含）至明日 00:00（不含）之間、`cancelled_at IS NULL` 的所有 `events` 行。

事件 SHALL 按 `start_time` 升序排列；全日事件（`is_all_day = true`）SHALL 排在所有非全日事件之前。

#### Scenario: 今日有跨午夜事件
- **WHEN** 一個事件 `start_time` 為今日 23:30、`end_time` 為明日 01:00
- **THEN** 它出現在「今日」集合內（判斷只看 `start_time`）

#### Scenario: 今日有已取消事件
- **WHEN** 一個事件 `start_time` 在今日範圍內但 `cancelled_at` 非 NULL
- **THEN** 它唔出現在「今日」集合內

#### Scenario: 全日事件排序
- **WHEN** 今日同時有一個全日事件（`is_all_day = true`）與一個 09:00 事件
- **THEN** 全日事件排在前面

#### Scenario: 今日冇任何事件
- **WHEN** 今日範圍內零個符合條件的事件
- **THEN** `today` 為空陣列（唔係 null）

### Requirement: 即將到事件查詢與相關性過濾

Briefing 查詢層 SHALL 輸出「即將到」的事件集合，按相關性分兩層過濾：

- **linked 事件**：未來 7 日內（由明日 00:00 起至第 8 日 00:00 前）
- **context 事件**：未來 2 日內（由明日 00:00 起至第 3 日 00:00 前）

相關性 SHALL 由查詢層以以下順序判定，唔讀 `events.relevance` 欄位：

1. **noise**：`title` 符合 `^Day\s*[A-FＡ-Ｆ]`（全形或半形字母）→ 標為 `noise`，**唔列入「即將到」**（循環日另以 `cycle` 段落輸出）
2. **linked**：`title` 含下列任一 keyword（大小寫不敏感）→ 標為 `linked`
   - `民`, `Dickson`, `林民平`, `Lam Man Ping`
   - `課程主任`, `PSMCD`
   - `學教`, `常識`, `人文`, `科學`, `國安`, `國家安全`
3. **context**：其餘

#### Scenario: linked 事件在 5 日後
- **WHEN** 一個 title 含「學教」的事件在 5 日後
- **THEN** 它出現在「即將到」集合內

#### Scenario: context 事件在 5 日後
- **WHEN** 一個 title 唔含任何 keyword 的事件在 5 日後
- **THEN** 它唔出現在「即將到」集合內（超出 2 日窗口）

#### Scenario: context 事件在 2 日內
- **WHEN** 一個 title 唔含任何 keyword 的事件在 2 日內
- **THEN** 它出現在「即將到」集合內

#### Scenario: Day 事件唔入「即將到」
- **WHEN** 一個 title 為 `Day A` 或 `DayＡ` 的事件在 3 日後
- **THEN** 它唔出現在「即將到」集合內（屬 noise）

#### Scenario: 全形與半形字母都識別為 Day
- **WHEN** title 為 `Day B`（半形）或 `DayＢ`（全形）
- **THEN** 兩者都被判定為 `noise`


### Requirement: 事件去重（跨帳號）

Briefing 的 `today` 與 `upcoming` 陣列 SHALL 移除跨帳號重複的事件。

兩個事件視為重複的條件：`title`（`trim()` 後）完全相同 **且** `start_time` 落在同一分鐘（YYYY-MM-DDTHH:MM）。

去重時 SHALL 保留 `account_key = 'work'` 的那一行（刪除 personal 的重複）；若只有 personal，則保留 personal。

比較 SHALL 大小寫敏感、空白敏感（唔做模糊匹配）—— 字面不同的 title（例如 `（汪譚健雯莉）` vs `（汪譚健雯穎莉）`）SHALL NOT 被視為重複。

#### Scenario: work 與 personal 有同一事件
- **WHEN** 同一事件在 `work` 與 `personal` 都有（title 相同、start_time 同一分鐘）
- **THEN** 輸出只保留 `account_key = 'work'` 的一行

#### Scenario: 只有 personal 的事件
- **WHEN** 一個事件只在 `personal` 有（例如 `觀課：高3A人文`）
- **THEN** 它保留在輸出內（唔會被刪）

#### Scenario: title 串法不同
- **WHEN** 兩個事件 title 分別為 `賣書日（汪譚健雯莉）` 與 `賣書日（汪譚健雯穎莉）`，start_time 同一分鐘
- **THEN** 兩行都保留（唔視為重複）

#### Scenario: 同一帳號內的真重複
- **WHEN** `work` 帳號內有兩個 title 與 start_time 都相同的事件（理論上唔應該發生，但 Google 可能返回重複 instance）
- **THEN** 只保留一行

#### Scenario: 去重唔影響排序
- **WHEN** 去重後
- **THEN** `today` / `upcoming` 仍按 `is_all_day DESC` → `start_time ASC` → `id ASC` 排序

### Requirement: 循環日查詢

Briefing 查詢層 SHALL 讀取 `cycle_days` 表，輸出今日與明日（若存在）的 `day_label`。

#### Scenario: 今日有循環日
- **WHEN** `cycle_days` 有今日日期的一行，`day_label = 'D'`
- **THEN** 輸出的 `cycle.today` 為 `'D'`

#### Scenario: 今日冇循環日（假期）
- **WHEN** `cycle_days` 冇今日日期的行
- **THEN** 輸出的 `cycle.today` 為 `null`

#### Scenario: 明日有循環日
- **WHEN** `cycle_days` 有明日日期的一行，`day_label = 'E'`
- **THEN** 輸出的 `cycle.tomorrow` 為 `'E'`

### Requirement: 任務分級查詢

Briefing 查詢層 SHALL 輸出所有 `status = 'todo'` 且 `deleted_at IS NULL` 的任務，按 `priority` 分四組：`critical`、`high`、`medium`、`low`。

每組內 SHALL 先按 `pinned DESC`、再按 `due_date ASC NULLS LAST`、再按 `created_at ASC` 排序。

`due_date` 早於今日的任務 SHALL 額外標記 `overdue = true`。

#### Scenario: 四級分組
- **WHEN** 有 4 個任務，priority 分別為 critical / high / medium / low
- **THEN** 輸出分為四組，每組一個任務

#### Scenario: pinned 優先
- **WHEN** 同一 priority 組內有一個 `pinned = true` 的任務與一個 `pinned = false` 的任務
- **THEN** `pinned = true` 排在前面

#### Scenario: 逾期標記
- **WHEN** 一個任務 `due_date` 為昨日
- **THEN** 該任務的 `overdue` 為 `true`

#### Scenario: 已完成任務唔出現
- **WHEN** 一個任務 `status = 'done'`
- **THEN** 它唔出現在任何組

#### Scenario: 軟刪除任務唔出現
- **WHEN** 一個任務 `deleted_at` 非 NULL
- **THEN** 它唔出現在任何組

#### Scenario: tasks 表空
- **WHEN** `tasks` 表零行
- **THEN** 四個組都係空陣列（唔係 null）


### Requirement: Afternoon 模式窗口

`briefing/fetch --mode afternoon` SHALL 輸出符合以下條件的事件（`cancelled_at IS NULL`）：

- `start_time >= 今日 13:00 HKT` 且 `start_time < 明日 00:00 HKT`，**或**
- `is_all_day = true` 且 `start_time` 落在今日（`[今日 00:00 HKT, 明日 00:00 HKT)`）

理由：全日事件（假期、校曆活動、賣旗日）的 `start_time` 永遠係當日 00:00，若只按 `>= 13:00` 過濾會**結構性漏掉全部全日事件**（review MAJOR #2）。

非全日且已過去的事件（`start_time < 13:00`）仍然唔報。

任務分組與 morning 相同（四級全量），循環日同樣輸出（供 skill 顯示「聽日」）。

#### Scenario: 13:00 前的非全日事件唔出現
- **WHEN** 今日有一個 09:00 的非全日事件
- **THEN** `--mode afternoon` 的 `today` 陣列唔包含它

#### Scenario: 全日事件一定出現（無論時間）
- **WHEN** 今日有一個 `is_all_day = true` 的「假期」事件（`start_time` 為今日 00:00 HKT）
- **THEN** `--mode afternoon` 的 `today` 陣列**包含**它

#### Scenario: 13:00 後的事件出現
- **WHEN** 今日有一個 15:00 事件
- **THEN** `--mode afternoon` 的 `today` 陣列包含它

#### Scenario: afternoon 唔輸出 upcoming
- **WHEN** `--mode afternoon`
- **THEN** `upcoming` 為空陣列（morning 已覆蓋，唔重複報）

### Requirement: JSON 輸出契約

Briefing 查詢層 SHALL 輸出單一 JSON 物件到 stdout，包含以下鍵：

```
{
  "generated_at": "<ISO 8601 with +08:00>",
  "date": "<YYYY-MM-DD, HKT>",
  "weekday": "<星期一…星期日>",
  "sync": { "stale": bool, "reason": string|null, "sources": [ { "key": string, "last_run_at": string|null, "status": string|null } ] },
  "cycle": { "today": string|null, "tomorrow": string|null },
  "today": [ <event>... ],
  "upcoming": [ <event>... ],
  "tasks": { "critical": [...], "high": [...], "medium": [...], "low": [...] }
}
```

每個 `<event>` SHALL 含 `id`、`title`、`start_time`、`end_time`、`is_all_day`、`account_key`、`source_calendar`、`relevance`（`linked`|`context`|`noise`）。

每個 `<task>` SHALL 含 `id`、`title`、`priority`、`category`、`due_date`、`pinned`、`overdue`。

#### Scenario: 輸出可被 json.loads 解析
- **WHEN** script 執行完成
- **THEN** stdout 係合法 JSON（單一物件，唔夾雜 log）

#### Scenario: 診斷訊息走 stderr
- **WHEN** script 需要輸出警告（例如連線重試）
- **THEN** 警告寫入 stderr，唔污染 stdout 的 JSON

### Requirement: 錯誤處理

Briefing 查詢層 SHALL 在 Supabase 請求失敗時以非零 exit code 結束，並將錯誤訊息寫入 stderr。

#### Scenario: 連線失敗
- **WHEN** Supabase 無法連線（DNS / timeout / 401）
- **THEN** script exit code 非零，stderr 含具體錯誤

#### Scenario: 部分查詢失敗
- **WHEN** `events` 查詢成功但 `cycle_days` 查詢失敗
- **THEN** script exit code 非零（唔輸出部分 JSON 令上游誤以為完整）
