# Design: add-docs-drift-check

## 為什麼用 TypeScript 而唔係 shell / Python

| 選項 | 否決理由 |
|---|---|
| Shell（bash）| Windows 上有 git-bash / WSL / cmd 三種環境，行為唔一致；JSON 解析要靠 `python -c` 或 `jq`，兩個都唔一定裝 |
| Python | 本機 `python3` 是 3.14.9 但 `pip` 指向 3.11（已知 mismatch），script 依賴會踩雷 |
| **TypeScript** | repo 已有 `tsconfig.json` + vitest，**零新依賴**；同一套 typecheck 管住；Windows 原生 |

決定：`scripts/docs-check.ts`，用 **`node --experimental-transform-types`** 跑。

**實測（2026-11-28，Node v22.22.3）**：
```
$ node --experimental-transform-types .ai/t.ts
OK a 1
exit=0
```

⚠️ **本機冇 `tsx`**（`node_modules/.bin/` 只有 `tsc` 同 `vitest`）—— 第一版 design 寫 `npx tsx` 係錯的，會引入新依賴。
`node:sqlite` 亦係 Node 22 內建（experimental），同樣零新依賴。

## 為什麼讀 `SYSTEM.md §4` 而唔係自己寫清單

核心原則：**唔可以有兩份真相**。

如果 script 內寫死 `["daily-briefing", "capture-dual-write", ...]`，那份清單會同 `SYSTEM.md §4` 各自腐爛 —— 正是 2026-11-28 事故的同型錯誤（三個地方三種講法）。

所以：`SYSTEM.md §4` 係唯一資料源，script 只係驗證它。

代價：parser 依賴表格格式。→ 用「格式唔對就明確報錯」處理，唔靜默跳過。

## §4 表格格式契約

```markdown
| Spec（L3）| Runtime 實作（L4 / L3 code）| 其他受影響 |
|---|---|---|
| `specs/daily-briefing/spec.md`（9 req）| `skills/daily-briefing/SKILL.md` 全部<br>`briefing/fetch.ts`（時間窗、去重、sync）<br>**`briefing/relevance.ts`**（keyword 分類 = 2026-11-28 事故主角）| cron `43e12b7b639e`（0700）+ ... |
```

Parser 規則：
1. 搵 `## 4.` 開頭的章節
2. 該章節內第一個 markdown 表格
3. 跳過 header 行 + `|---|` 分隔行
4. 每行 split `|`，要 3 欄（去掉頭尾空）
5. 每欄內抽出所有 backtick 包住的 token（`<br>` 分隔多個）
6. **L4 vs L3 判斷**：token 以 `skills/` / `SOUL.md` / `cron/` 開頭 → L4；其他 → L3
   - 唔用「含唔含 `src/`」判斷，因為 `n8n/workflows/` 兩者都唔係

## 檢查項執行順序

```
1. parse SYSTEM.md §4        格式錯 → 即刻 exit 1（唔需要跑其他）
2. spec 存在性               openspec/specs/<name>/spec.md
3. runtime 存在性            L3: repo 相對 / L4: profiles 相對
4. cron/jobs.json
   4a. skills 目錄存在
   4b. schedule.expr 格式
5. n8n hash（可選）
   5a. sqlite 存在？ 冇 → 跳過
   5b. 有 → 比 nodes + connections
```

每步獨立累積失敗，最後一次 exit。

## 為什麼唔加入 `npm test`

考慮過：
```json
"pretest": "npm run docs:check"
```

否決：`npm test` 應該只測 code 行為。加了會令：
- 改 SKILL.md（L4）的人被迫在 repo 跑 test
- CI 環境冇 `%LOCALAPPDATA%\hermes\profiles\` → 全部 L4 檢查 fail

所以 `docs:check` 獨立，由人 / CI step 決定何時跑。CI 只跑 L3 + spec 部分（加 `--no-l4` flag）。

## `--no-l4` flag

CI 環境冇 Hermes profile。加 flag 令 CI 可以只檢查 repo 內的部分。

```
npm run docs:check           # 全部
npm run docs:check --no-l4   # 跳過 profile 檢查（CI）
```

## 失敗輸出格式

```
=== docs:check ===

[1/4] SYSTEM.md §4 格式
  OK  表格存在，7 行

[2/4] spec 檔案存在性
  OK  specs/daily-briefing/spec.md
  OK  specs/capture-dual-write/spec.md
  FAIL specs/calendar-sync/spec.md
       期望: openspec/specs/calendar-sync/spec.md
       實際: 檔案不存在
       §4 行: | `specs/calendar-sync/spec.md`（8 req）| `n8n/workflows/...` |

[3/4] runtime 路徑存在性
  OK  briefing/fetch.ts
  FAIL skills/daily-briefing/SKILL.md
       期望: C:\Users\User\AppData\Local\hermes\profiles\personal-assistant\skills\daily-briefing\SKILL.md
       實際: 檔案不存在

[4/4] cron/jobs.json
  OK  7 個 job，skills 全部存在
  FAIL 89aa9f1296f2（學校Calendar同步（週末））
       skills 引用唔存在的 skill: school-calendar-sync

=== 結果：3 項失敗 ===
exit 1
```

## 測試策略

`tests/docs-check.test.ts`：
- parse §4 表格（正常 / 缺章節 / 欄位數錯）
- L3 vs L4 路徑解析
- 用 fixture 目錄模擬存在 / 唔存在
- cron 表達式驗證（合法 / 欄位數錯）

**唔測**真實檔案系統的當前狀態（那是 `docs:check` 自己跑的工作，唔是 test 的工作）。
