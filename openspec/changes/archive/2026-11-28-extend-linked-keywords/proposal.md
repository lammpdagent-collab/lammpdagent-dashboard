# Proposal: extend-linked-keywords

## Why

2026-11-28 實測（30 日 query，107 個 event）：**52 個 context event 目前唔在「即將到」** —— 它們同時超出 2 日 context 窗**同** 7 日 linked 窗。當中包括：

- `觀課：樂5B科`（2026-12-09）
- `觀課：婷5A英`（2026-12-11）

但同類事件 `觀課：高3A人文`、`觀課：詩3E人文` **會顯示** —— 只因為 title 含「人文」。

**分類結果取決於科目名稱，唔係事件性質。** 觀課係 Dickson 的日常工作，唔應該因為教咩科而決定顯示優先級。

### 加 keyword 的實際作用（唔係「由唔顯示變顯示」）

以 `觀課：樂5B科`（2026-12-09）為例：

| 情境 | 進入「即將到」的日期 | 提前 |
|---|---|---|
| **context**（現狀）| 2026-12-08（進入 2 日窗）| — |
| **linked**（改動後）| **2026-12-02**（進入 7 日窗）| **6 日** |

所以今次改動**唔會令今日（11-28）的 briefing 多出任何項目**，但會令 12 月的觀課提早約 6 日曝光。

⚠️ 第一版 proposal 寫「因超過 2 日窗而唔顯示」係唔準確的 —— 它們同時超出 7 日 linked 窗，所以連「應該顯示但被截走」都講唔上。多謝 opencode 在實作階段指出。

## What Changes

- `briefing/relevance.ts` 的 `RELEVANCE_KEYWORDS` 加 `'觀課'`
- `specs/daily-briefing` 的 keyword 清單同步加 `觀課`
- 加測試：`觀課：樂5B科` → `linked`

## Capabilities

### Modified Capabilities

- `daily-briefing`: 「即將到事件查詢與相關性過濾」的 linked keyword 清單由 12 個增至 13 個（加「觀課」）

## Impact

**改動**
- `briefing/relevance.ts`（+1 keyword）
- `tests/briefing.test.ts`（+2 tests）
- `openspec/specs/daily-briefing/spec.md`（keyword 清單）

**行為影響（實測預估）**
- 30 日內新增顯示：`觀課：樂5B科`（+11d）、`觀課：婷5A英`（+13d）—— 至少 2 個
- 其他含「觀課」的 event 會一併變成 linked（需實際跑一次確認總數）

**唔影響**
- DB schema、n8n、capture 流程、dashboard UI
- 現有 12 個 keyword 的行為
