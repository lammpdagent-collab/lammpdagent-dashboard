# Tasks: add-docs-drift-check

## 1. 實作 `scripts/docs-check.ts`

- [x] 1.1 建 `scripts/docs-check.ts` 骨架：CLI 入口、`--no-l4` flag 解析、exit code
- [x] 1.2 實作 `parseSystemSection4()`：讀 `SYSTEM.md`、搵 `## 4.` 章節、抽第一個表格、每行 split 3 欄、抽 backtick token
- [x] 1.3 格式錯誤處理：冇 §4 章節 / 冇表格 / 欄位數唔對 → 明確報錯 + exit 1
- [x] 1.4 實作 `classifyPath()`：判斷 token 係 L3（repo 相對）定 L4（profile 相對）
- [x] 1.5 實作 spec 存在性檢查
- [x] 1.6 實作 runtime 存在性檢查（含 L4 路徑解析，Windows / POSIX 兩種）
- [x] 1.7 實作 `cron/jobs.json` 檢查：skills 目錄存在 + `schedule.expr` 5 欄位格式
- [x] 1.8 實作 n8n hash 檢查（用內建 `node:sqlite`，已實測可用），環境冇 sqlite 時跳過
- [x] 1.9 實作輸出格式（繁體中文、分節、FAIL 帶期望/實際/行號）
- [x] 1.10 實作 `--no-l4` flag：跳過所有 L4 檢查

## 2. 接入 package.json

- [x] 2.1 `package.json` 加 `"docs:check": "node --experimental-transform-types scripts/docs-check.ts"`
- [x] 2.2 跑 `npm run docs:check` 確認可以執行（**預期會有失敗** —— 呢個正係目的）

## 3. 測試

- [x] 3.1 寫 `tests/docs-check.test.ts`：parse §4 表格（正常 / 缺章節 / 欄位數錯）
- [x] 3.2 測 L3 vs L4 路徑分類
- [x] 3.3 測 cron 表達式驗證（合法 / 欄位數錯）
- [x] 3.4 用 fixture 模擬檔案存在 / 唔存在
- [x] 3.5 `npm test` 全綠

## 4. 文件同步

- [x] 4.1 `SYSTEM.md §7`「改 spec 時」檢查清單加一句：跑 `npm run docs:check`
- [x] 4.2 `PROJECT.md §2.2` 加登記 `scripts/**`（T1，工具）
- [x] 4.3 `SYSTEM.md §11` 加一句：`docs:check` 是「機械檢查」那條路，同 tasks.md 打勾互補

## 5. L4 Runtime 同步

**唔適用** —— 本 change 只新增 repo 內工具，唔改任何 SKILL.md / SOUL.md / cron / n8n。

- [x] 5.1 確認唔改 L4（已確認）

## 6. 驗證

- [x] 6.1 `npm run typecheck` 綠
- [x] 6.2 `npm test` 綠
- [x] 6.3 `npm run build` 綠
- [x] 6.4 `npm run docs:check` 跑一次，**記錄實際輸出**（可能有真 drift 被發現 —— 呢個係預期收穫，唔係 bug）
- [x] 6.5 `openspec validate "add-docs-drift-check" --strict` 過
