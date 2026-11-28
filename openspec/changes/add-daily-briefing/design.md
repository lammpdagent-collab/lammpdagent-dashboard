## Context

Phase 4 把 `daily-briefing` 的資料源由 Obsidian vault + Google API 直讀，換成 Supabase。現役 skill 在 `personal-assistant` profile（`C:/Users/User/AppData/Local/hermes/profiles/personal-assistant/skills/daily-briefing/SKILL.md`），本 session 屬 `coding` profile。

約束：
- $0/月（唔加付費依賴）
- 繁體中文輸出（zh-Hant）
- 唔可以同時有兩個 Telegram webhook consumer（v0.4 已拍板 Hermes 獨佔）
- `AGENTS.md`：schema 改動只可經 migration

## Goals / Non-Goals

**Goals**
- briefing 資料來自 Supabase（單一真相）
- 保留 Dickson 已習慣的 code block 格式（零學習成本）
- 查詢邏輯可獨立測試（唔需要 Hermes / cron）
- 新舊 briefing 可以並排對比一段時間

**Non-Goals**
- 唔改 dashboard（Phase 2 已完成）
- 唔改 n8n workflow（`events.relevance` 保持 `context`）
- 唔遷移 vault（Phase 5）
- 唔做 HTML 版（後續 change）

## Decisions

### D1 — 查詢層放 repo，唔放 skill

**決定**：新增 `briefing/fetch.py` 在 dashboard repo；skill 只負責「跑 script + 按 template 排版」。

**理由**：
- skill 檔案喺 Hermes profile，改它唔經 OpenSpec、唔可以 opencode 生成、冇 tests
- script 喺 repo → 可以 `pytest`、可以 `git diff` 審核、可以 opencode 實作
- 日後 dashboard 或者其他前端要同一個資料視角，可以直接 import

**代價**：skill 要寫死絕對路徑（`C:/Users/User/Documents/GitHub/lammpdagent-dashboard/briefing/fetch.py`）。可接受 —— cron 同機執行。

### D2 — relevance 判斷在查詢層，唔寫 DB

**決定**：`fetch.py` 用 title keyword + `source_calendar` 規則，即時計算 `linked` / `context` / `noise`，唔更新 `events.relevance`。

**理由**：
- `calendar-sync` spec 冇要求 sync 填 relevance → 唔填唔係 bug
- 若寫 DB 要 migration + 改 n8n workflow（Phase 3 剛 archive，唔想即刻重開）
- keyword 清單會演化（新學校職務、新科目），在 repo 改一行 + commit 比改 DB + 重跑 backfill 便宜
- 判斷錯可以即刻修，唔需要等下一輪 sync

**代價**：`events.relevance` 欄位維持 `context`，形成「欄位存在但冇用」的認知負擔。緩解：design 記錄此事實；若日後要寫入，另開 change。

### D3 — Keyword 清單沿用舊系統

**決定**：linked 判定 keyword 沿用 `daily-briefing` skill 現有的 fallback 清單：
`民`, `Dickson`, `林民平`, `Lam Man Ping`, `課程主任`, `PSMCD`, `學教`, `常識`, `人文`, `科學`, `國安`, `國家安全`

**理由**：Dickson 已用此清單一段時間，實測有效。唔引入未驗證的新清單。

**已知限制**：舊系統有 `🔗` 手動標記（更準），新系統冇 → keyword 判斷係純字面匹配，會漏（例：`QTN會議` 冇 keyword 但實際關 Dickson 事）。**明講限制，唔假裝可靠**。

### D4 — 時間窗全部用 HKT 邊界，查詢用 UTC

**決定**：計算在 Python 內做（`zoneinfo.ZoneInfo("Asia/Hong_Kong")`），轉 UTC ISO 字串後傳 PostgREST。

**理由**：Phase 3 已證實 PostgREST 唔 decode `%2B`（`+08:00` 的 `+`）→ 必須用 `Z` 結尾的 UTC。

**邊界定義**（避免重複的 `start_time` parameter，Phase 3 build 的教訓）：
- 今日：`[today 00:00 HKT, tomorrow 00:00 HKT)` → 用 `and=(start_time.gte.X,start_time.lt.Y)`
- 即將到 linked：`[tomorrow 00:00, +8 days 00:00)`
- 即將到 context：`[tomorrow 00:00, +3 days 00:00)`

### D5 — 唔用 GAPI 直讀 Google Calendar

**決定**：briefing 只讀 Supabase。

**理由**：
- 舊系統直讀 Google 會令 briefing 的資料同 dashboard 唔一致（兩個快照時間）
- 每次 briefing 打 Google API 浪費 quota（Dickson 對 quota 敏感）
- Phase 3 已保證 Supabase 每 30/60 分鐘同步

**代價**：briefing 最多滯後 30 分鐘。可接受 —— 「今日要做乜」唔需要秒級新鮮度。

### D6 — 跨 profile 邊界：實作分兩段

**決定**：
- 本 session（`coding` profile）負責：`briefing/fetch.py`、`tests/test_briefing.py`、spec、design
- 修改 `personal-assistant` 的 SKILL.md 與 cron **需要 Dickson 明示批准**（跨 profile 寫入）
- 具體做法：把新 SKILL.md 內容寫成 repo 內的 `briefing/SKILL.patch.md`（或 diff），由 Dickson 或者 personal-assistant session 套用

**理由**：系統邊界明確規定「do NOT modify another profile's skills/plugins/cron/memories unless the user explicitly directs you to」。

### D7 — 新鮮度門檻 26 小時

**決定**：`last_run_at` 距今 ≥ 26 小時 → `stale = true`。

**理由**：
- 整點排程每小時一次 → 正常最長滯後 1 小時
- 若 n8n 停了，26 小時 = 一整日 + 2 小時寬限 → 唔會因為單次錯過就報警
- 唔用「status = error」單獨判斷，因為 Phase 3 的 P3-G 決定「失敗唔重試，等下次排程」→ 一次失敗會自動被下次成功覆蓋

### D8 — 錯誤處理 fail loud

**決定**：任何查詢失敗 → 非零 exit + stderr 詳情，唔輸出部分 JSON。

**理由**：舊系統有「3 個 job delivery=local，靜默壞」的歷史問題（v0.4 發現 P6）。寧願 cron 報錯，唔要靜默出空白 briefing。

**代價**：cron 失敗時 Dickson 收唔到 briefing。緩解：Hermes cron 本身有 delivery 失敗記錄。

## Risks / Trade-offs

| 風險 | 影響 | 緩解 |
|---|---|---|
| keyword 判斷漏 linked 事件 | briefing 少報重要會議 | design 明講限制；Dickson 可要求加 keyword；保留舊系統對比期 |
| `tasks` 表 0 行 | 「進行中」段落長期空白 | 屬預期（Dickson 未開始用）；dashboard 已可新增 |
| 跨 profile 修改出錯 | personal-assistant 的 cron 壞 | 分兩段實作；改前備份 jobs.json |
| PostgREST 同名 parameter | filter 靜默失效（Phase 3 曾誤標 1,212 行）| 統一用 `and=(...)`；tests 覆蓋 |
| 時間邊界 off-by-one | 漏報或重複報午夜事件 | 統一定義 `[start, end)`；tests 用固定時間 fixture |

## Migration Plan

1. 實作 `briefing/fetch.py` + tests（repo，經 opencode）
2. 驗證：手動跑 script，同現役 briefing 並排對比 3 日
3. Dickson 批准後，改 `personal-assistant` 的 SKILL.md（資料讀取段落）
4. 觀察 1 週：兩套並存（舊 cron 停用但 skill 保留 fallback）
5. 穩定後，Phase 5 處理 vault 遷移

**Rollback**：skill 保留舊讀取段落於 `## Legacy (vault) fallback` 章節註釋內，需要時還原。

### D9 — Capture 順序：Supabase 先，vault 後

**決定**：Capture 收到 → 先 `POST /rest/v1/tasks`（或 `events`）→ 成功後即刻回覆 Dickson → 然後 subagent 寫 vault。

**理由**：
- 「最快有 data」是 Dickson 明確要求（原話：「確保新系統最快有入好data」）
- Supabase 寫入 = 1 個 HTTP POST，約 0.3-1 秒；vault 寫入 = 讀 3 個檔案 + 改 + 寫，約 2-3 秒，而且 token 貴
- 若先寫 vault 再寫 Supabase，Dickson 要等 3-4 秒才見確認
- Fail loud 原則：Supabase 失敗就報錯，唔做 vault（避免標本有、真相冇）

**代價**：Supabase 成功後 vault 失敗，兩邊唔一致。設計上接受（見 D11）。

### D10 — Vault 寫入用 subagent，唔用主流程

**決定**：`delegate_task` 開 subagent 執行 vault 寫入。

**理由**：
- Vault 寫入要讀 `任務.md` + `事件.md` + `收件箱.md`（可能幾千 token），若在主流程做會令主 context 膨脹
- Capture 是高頻操作（一日多次），主 context 膨脹會令長 session 質素下降
- Subagent 有獨立 context window，完成後只回一句結果

**代價**：
- 多一次 LLM 往返（token 成本）
- Subagent 失敗可能靜默 → 要求 subagent 明確回報，Hermes 負責發警告

**唔用 subagent 的替代方案**（否決）：同一 turn 順序做 —— 簡單但令 Dickson 等 3-4 秒 + 主 context 膨脹。

### D11 — Vault 角色限定為觀察標本

**決定**：Vault 唔再作為任何系統功能的資料源。只由 capture 的 subagent 寫入。

**理由**（Dickson 原話）：「我想舊vault 仍然保持運作，按照舊模式寫入、link，但係唔再作為source，在新系統中無任何角色。佢只係我想睇下到學年尾到底會變成點而保留」

**具體含義**：
- `briefing/fetch.py` 唔讀 vault
- `daily-briefing` skill 唔讀 vault
- Dashboard 唔讀 vault
- Vault 停止更新唔影響任何系統功能

**代價**：Vault 的 `🔗` 手動 link 唔會反映到 Supabase（`events.relevance` 維持 `context`）。已由 D2 的 keyword 判斷部分補償。

### D12 — 接受 Dual write 不一致

**決定**：Supabase 同 vault 可能唔一致（其中一邊失敗、或者分類判斷有差異），唔做 reconciliation。

**理由**：
- Supabase 係真相，vault 係標本 —— 標本不準唔需要修正
- 做 reconciliation 要讀 vault 全部內容 + 比對 Supabase，成本高、收益低
- Dickson 只是想「睇下到學年尾變成點」，唔要求精確鏡像

**例外**：若 Supabase 寫入失敗，唔寫 vault（保持「真相優先」原則）。

### D13 — 被動查詢（MODE 3）改讀 Supabase

**決定**：MODE 3 由「查 vault + Google Calendar + Hindsight」改為「查 Supabase（`fetch.py --mode query`）+ Hindsight」。

**理由**：
- Phase 4 之後 vault 只由 subagent 寫入，可能落後（subagent 失敗就完全唔更新）
- 查 vault 會答過期資料，比唔答更差
- 用同一資料層（`fetch.py`）避免重複實作時間窗與 PostgREST 參數組法

**代價**：
- 擴大 Phase 4 範圍（多一個 CLI mode + 多一套查詢邏輯）
- `筆記` / `收件箱` 類記錄 Supabase 冇對應表 → MODE 3 查唔到（明講限制）
- Hindsight 仍然查（跨 session 事實）

**唔改的代價**：答過期資料，Dickson 會失去信任。

## Open Questions

1. 「即將到」是否應該包含明日的事件？（現設計：明日算「即將到」，唔算「今日」）→ 沿用舊系統
2. afternoon（1300）briefing 的資料窗：舊系統只報 13:00 後的事件 → 沿用
3. 是否保留「手動」模式（Dickson 要求即出）→ 保留，但資料源同樣換 Supabase
