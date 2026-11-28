# Delta Spec: extend-linked-keywords

## MODIFIED Requirements

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
   - `觀課`
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

#### Scenario: 觀課事件唔論科目都算 linked
- **WHEN** title 為 `觀課：樂5B科`（唔含原有任何 keyword）且事件在 11 日後
- **THEN** 它被判定為 `linked`
- **THEN** 它出現在「即將到」集合內（未超出 7 日窗）

#### Scenario: 觀課事件在 8 日後仍唔顯示
- **WHEN** title 為 `觀課：樂5B科` 且事件在 8 日後
- **THEN** 它被判定為 `linked`，但超出 linked 的 7 日窗
- **THEN** 它唔出現在「即將到」集合內
