# Proposal: add-docs-drift-check

## Why

2026-11-28 事故暴露一個結構性問題：`PROJECT.md` 記錄了系統地圖，`AGENTS.md` L5 甚至明文寫「唔知去邊度搵答案？先睇 `PROJECT.md`」，但**事故照樣發生** —— 因為沒有任何機制會 fail。

三輪獨立 review（glm-5.3-flash）進一步證實：新建的 `SYSTEM.md` 本身**第一稿就有 1 個 BLOCKER**（三個 skill 路徑全錯、`~/.n8n/workflows` 目錄根本唔存在、「7 個 workflow」實際只有 1 個）。文件寫得再仔細，都會 rot。

**結論**：靠人記得 = 靠唔住。要有東西會 fail。

## What Changes

- 新增 `scripts/docs-check.ts`（Node/TypeScript，用現有 toolchain，**零新依賴**）
- 新增 npm script：`npm run docs:check`
- 檢查項（全部讀 `SYSTEM.md §4` 對應表作為資料源，唔寫死路徑清單）：
  1. §4 每一行的 spec 檔存在於 `openspec/specs/<name>/spec.md`
  2. §4 每一行的 runtime 路徑存在（L3 直接用相對路徑；L4 加 `%LOCALAPPDATA%\hermes\profiles\personal-assistant\` 前綴）
  3. `cron/jobs.json` 每個 job 的 `skills` 陣列，每個名稱對應一個存在的 skill 目錄
  4. `cron/jobs.json` 每個 job 的 `schedule.expr` 是合法 cron 表達式（基本格式）
  5. **（可選，環境容許時）** n8n live vs `n8n/workflows/*.json` 的 nodes + connections hash 一致
- 任何一項失敗 → 印出「哪一行、期望什麼、實際什麼」→ `exit 1`
- 加入 `npm test` 之前的 hook？**唔加** —— 保持 `docs:check` 獨立可跑，由 CI / 人呼叫

## Capabilities

### New Capabilities

- `docs-drift-check`: 驗證 `SYSTEM.md §4` 對應表所聲稱的 spec↔runtime 關係在現實中仍然成立，失敗即 exit 1

### Modified Capabilities

（無 —— 這個 change 唔改任何既有 spec 的行為）

## Impact

**新增檔案**
- `scripts/docs-check.ts`
- `openspec/specs/docs-drift-check/spec.md`（archive 時產生）

**修改檔案**
- `package.json`（加一個 script）
- `SYSTEM.md` §7（檢查清單加一句「跑 `npm run docs:check`」）
- `PROJECT.md` §2.2（加登記 `scripts/**`）

**唔影響**
- 任何 runtime 行為（briefing / capture / cron / n8n 全部唔動）
- 任何既有 spec 的 requirement
- 任何 DB schema

**風險**
- 低。純新增工具，唔改任何執行路徑。
- 唯一風險：`docs-check` 讀 `SYSTEM.md` 的表格格式，如果日後改格式要同步改 parser → 用 `design.md` 定義格式契約，並在 parser 加「格式唔對就明確報錯」而非靜默跳過。
