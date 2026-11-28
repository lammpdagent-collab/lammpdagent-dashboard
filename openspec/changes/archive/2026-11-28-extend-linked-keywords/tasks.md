# Tasks: extend-linked-keywords

## 1. 改 code

- [x] 1.1 `briefing/relevance.ts` 的 `RELEVANCE_KEYWORDS` 加 `'觀課'`（附一行註釋講日期同理由）

## 2. 測試

- [x] 2.1 `tests/briefing.test.ts` 加：`觀課：樂5B科` → `linked`
- [x] 2.2 加：`觀課：婷5A英` → `linked`
- [x] 2.3 確認既有 12 個 keyword 的測試全部仍通過
- [x] 2.4 `npm test` 全綠

## 3. 實測驗證

- [x] 3.1 跑 `briefing/fetch.ts --mode morning`，記錄 `upcoming` 的 linked/context 數量變化
- [x] 3.2 確認 `觀課：樂5B科`、`觀課：婷5A英` 由 context 變 linked
- [x] 3.3 記錄分類變化（query mode 驗證）：`觀課：樂5B科`、`觀課：婷5A英`、`觀課：昕5B英` 由 context → linked
      **註**：morning briefing 今日唔會多出項目（它們仍超出 7 日窗）；價值在於進入窗後提早約 6 日顯示

## 4. 文件同步

- [x] 4.1 `openspec/specs/daily-briefing/spec.md` 經 archive 更新 keyword 清單

## 5. L4 Runtime 同步

- [x] 5.1 檢查 `skills/daily-briefing/SKILL.md` 有冇列 keyword 清單 —— 若有，同步加「觀課」；若冇（只講「由 fetch.ts 判定」），唔需要改
- [x] 5.2 **本次唔改 SKILL.md 的 vault 段落** —— 那是獨立的 S1 問題，要另一個 change

## 6. 收工

- [x] 6.1 `npm run typecheck && npm test && npm run build`
- [x] 6.2 `npm run docs:check`
- [x] 6.3 `openspec validate "extend-linked-keywords" --strict`
