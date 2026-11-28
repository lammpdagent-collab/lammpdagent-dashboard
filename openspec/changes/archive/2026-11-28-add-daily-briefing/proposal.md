## Why

Phase 3 已把 Google Calendar 同步入 Supabase（1,570 events / 93 cycle_days），但這些資料目前只有 dashboard 用得到。Dickson 的兩個高頻場景仍然依賴舊 vault：

1. **朝早一眼睇完今日要做乜** —— `daily-briefing` skill 讀 vault + 直打 Google API
2. **Telegram capture** —— Hermes 寫入 vault（`任務.md`／`事件.md`／`收件箱.md`）

結果：`tasks` 表 0 行，dashboard 冇任務，briefing 讀唔到新 capture。新系統（Supabase）同舊系統（vault）並存但唔連通。

Phase 4 打通兩邊：**Supabase 成為唯一真相**，vault 降級為「觀察標本」—— Dickson 想睇到學年尾它自然變成點，但佢唔再有任何系統角色。

## What Changes

**A. Briefing 讀取（純讀）**
- 新增 `briefing/fetch.ts`：讀 Supabase，輸出結構化 JSON（今日 events、將要到 events、任務四級分組、循環日、sync 新鮮度）
- 改 `daily-briefing` skill：由「讀 vault + GAPI 直讀」改為「跑 script 取 JSON」；template 段落不變
- cron 維持 0700 + 1300
- 相關性判斷在查詢層做：`events.relevance` 目前全部係 `context`（`calendar-sync` spec 冇要求填它），`fetch.ts` 用 title keyword + `Day A-F` 正則即時計算 `linked` / `noise` / `context`，**唔改 DB、唔加 migration**

**B. Capture 寫入（雙寫，Supabase 優先）**
- Capture 收到 → **先** POST Supabase（`tasks` 或 `events`）
- Supabase 成功 → **立即**回覆「✅ 已記低」（唔等 vault）
- 然後 `delegate_task` 開 subagent 用舊規則寫 vault（分類、`任務/` 詳情檔、`🔗` link、auto-match）
- Subagent 失敗 → 通知「⚠️ vault 寫入失敗（Supabase 已 OK）」

**C. 被動查詢改讀 Supabase**
- MODE 3（「我下禮拜有咩做」）由查 vault 改為查 Supabase
- `fetch.ts` 支援 `--mode query --from --to`（任意範圍，唔受 briefing 窗口限制）
- 範圍上限 366 日（防止拉全表）

**D. Vault 角色限定**
- Vault **唔再**作為任何系統功能的資料源
- 只由 capture 的 subagent 寫入，供 Dickson 觀察至學年尾
- Vault 停止更新唔影響 briefing / dashboard

**BREAKING（對 skill / capture 流程而言）**
- `daily-briefing` skill 唔再讀 vault
- Capture 流程由「寫 vault」改為「寫 Supabase + subagent 寫 vault」

## Capabilities

### New Capabilities

- `daily-briefing`: 早報的資料查詢契約 —— 事件窗口、相關性判定、任務分級、循環日、sync 新鮮度、JSON 輸出格式
- `capture-dual-write`: Capture 的寫入順序契約 —— Supabase 先、vault 後（subagent）、失敗處理、vault 角色限定
- `ad-hoc-query`: 被動查詢走 Supabase —— 任意日期範圍查詢、重用同一資料層、唔讀 vault

### Modified Capabilities

（無。`calendar-events`、`calendar-sync`、`sync-status`、`task-management` 的 requirement 不變 —— Phase 4 只是加讀取者與寫入者。）

## Impact

**新增檔案（repo）**
- `briefing/fetch.ts` — Supabase 查詢 + JSON 輸出
- `tests/briefing.test.ts` — 查詢邏輯測試（fixture，唔連 DB）
- `briefing/SKILL.patch.md` — 新 SKILL.md 的資料讀取段落（供套用）
- `briefing/SOUL.patch.md` — SOUL.md 的 capture 段落改動（供套用）

**修改檔案（跨 profile，需 Dickson 批准）**
- `personal-assistant/SOUL.md` — capture 流程改為 Supabase 優先 + subagent 寫 vault
- `personal-assistant/skills/daily-briefing/SKILL.md` — 資料讀取段落改為跑 script；template 不變
- `personal-assistant/cron/jobs.json` — 兩個早報 job 的 prompt 改為呼叫新流程

**依賴**
- Node v22.22.3（已裝，可直接跑 `.ts`）；TypeScript 7.0.2 + vitest 5.1.1（已有）；`@supabase/supabase-js` 2.119.2（已裝）
- 讀 `.env` 的 `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（已有）
- Hermes `delegate_task` tool（已有）

**風險**
- 跨 profile 寫入：本 session 屬 `coding` profile，改 `personal-assistant` 的 SOUL.md / skill / cron 係跨邊界操作，必須 Dickson 明示批准
- **Dual write 可能唔一致**：Supabase 成功但 vault 失敗（或相反）。設計上接受 —— Supabase 係真相，vault 係標本
- **`tasks` 表目前 0 行** → briefing 「進行中」段落會空，直到 capture 開始寫入
- **`tasks.status` 冇 `waiting`**（design D7 明確拒絕）→ 舊系統 `#waiting` 段落取消
- **舊系統「收件箱」概念**在新 schema 冇對應 → 取消該段落
- **keyword 判斷會漏** linked 事件（例如「QTN會議」冇 keyword 但實際關 Dickson 事）
- **Subagent 寫 vault 失敗可能靜默** → 要求 subagent 明確回報失敗，Hermes 負責發警告
