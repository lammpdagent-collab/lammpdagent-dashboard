# Design: extend-linked-keywords

## 為什麼唔係「全部 context 都 7 日窗」

Dickson 明確選擇保留 keyword 機制（2026-11-28）。

實測代價：30 日內 52 個 context event 超過 2 日。若全部改 7 日窗，「即將到」會由 18 項增至約 60 項 —— briefing 長度倍增，失去「一眼睇完」的價值。

keyword 機制的本意是「Dickson 會關心的事先顯示」，所以問題唔在機制，在清單唔全。

## 為什麼只加「觀課」

其他 52 個中可見的同類漏網（`全體教職員會議`、`學校旅行`、`家長晚會`、`年度核數`）Dickson 未指示要加。只加他明確要求的「觀課」。

若日後再發現漏，走同一個 change 模式（每個 keyword 一次，有測試）。

## 實作

`briefing/relevance.ts`：

```ts
export const RELEVANCE_KEYWORDS = [
  '民', 'Dickson', '林民平', 'Lam Man Ping',
  '課程主任', 'PSMCD',
  '學教', '常識', '人文', '科學', '國安', '國家安全',
  '觀課',   // 2026-11-28：觀課唔應因科目名唔同而跌出 7 日窗
] as const
```

零邏輯改動 —— `classifyRelevance` 已經用 `.some(includes)`，加一個字串即生效。

## 驗證

1. `npm test` —— 加 2 個觀課測試
2. 跑 `node --experimental-transform-types briefing/fetch.ts --mode morning`，確認 `觀課：樂5B科` 出現在 `upcoming` 且 `relevance = "linked"`
3. `npm run docs:check` —— 確認 spec↔runtime 對應仍成立
