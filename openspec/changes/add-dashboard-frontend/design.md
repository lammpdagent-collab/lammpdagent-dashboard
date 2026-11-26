## Context

Phase 1 已上線三張表（`tasks` 14 欄、`events` 17 欄、`system_meta` 5 欄），並 archive 了 `add-command-center-schema`。Phase 2 的工作全部建立在「Phase 1 schema 不變」的前提上，除了兩張新表。

全部決策已由 Dickson 逐項批准，記錄在 `Documents/Agent/projects/Personal Command Center - Phase 2 決策記錄.md`（30 個決策點）。本文件只記錄**為什麼**這樣做，以及被否決的替代方案。

主要使用者約束：

- Dickson 是教師，**打字是痛點** —— 一切高頻操作必須零打字
- 執行成本必須維持 **$0/月**
- 中文（zh-Hant）介面，時間硬編 `Asia/Hong_Kong`

## Goals / Non-Goals

**Goals**
- 讓 Dickson 每日可以在一分鐘內完成「睇任務 → 剔完成 → 睇今日日程」
- 兩部裝置（電腦 + 手機）即時同步（Realtime，<500ms）
- 補上 tag 目錄與 cycle day 兩個資料缺口

**Non-Goals**
- 不做離線快取（避免顯示過時資料造成誤判）
- 不做事件的新增／編輯（events 仍然只讀，寫入由 n8n 與 Hermes 負責）
- 不做收件箱 / triage（Doc1 §8 P13 已證明該流程從未運作）
- 不清理私人 calendar 上已存在的學校 clone 事件（過渡期以顯示層過濾解決）

## Decisions

### D1. 保留 Vite + TypeScript + Vitest，不採 Doc2 的 zero-build

**理由**：`tasks` + `events` 合共 31 個欄位、3 種 Realtime payload、多處日期格式轉換。zero-build 等於用 runtime 錯誤取代 compile-time 錯誤。工具鏈已存在（Phase 0 的 guestbook 已用 Vite），改成 zero-build 反而是拆除工作。

**替代方案**：zero-build（Doc2 原設計）—— 否決，因為本專案的錯誤成本集中在欄位名與時間格式，正是型別最擅長捕捉的範圍。

### D2. tag 目錄用獨立表，不用「從 tasks 衍生」

**理由**：衍生清單無法容納「存在但未被任何任務使用」的 tag。Dickson 明確要求「新增 tag 入 list」與「從 list 移除 tag」，這需要一個獨立於任務而存在的目錄。

`tasks.tags TEXT[]` 保持 denormalized（不改成 join table），因為：
- Phase 1 已上線，改成正規化需要 migration + 資料搬遷
- 查詢「某任務的 tags」只需讀該行，無需 join
- 目錄與實際使用的短期不一致（目錄有、任務未用）是可接受的

**替代方案**：`task_tags` join table —— 否決，成本高且 Phase 1 已上線。`localStorage` 存目錄 —— 否決，兩部裝置不同步。

### D3. cycle_days 用獨立表，不用 system_meta

**理由**：`system_meta` 的 CHECK 約束是 `key ~ '^calendar_sync:[a-z]+$'`。放 `cycle_days` 需要 ALTER 該約束，或者用語義錯誤的 key（`calendar_sync:cycledays`）。獨立表在語義與約束上都乾淨。

`events.day_cycle` 欄位保留但**不使用**（永遠 NULL，前端不讀）—— 刪除它需要 migration，而保留零成本。

**替代方案**：改 `system_meta` 的 CHECK 約束 —— 否決，會令 `calendar_sync:*` 的查詢邏輯要排除特例。用 `calendar_sync:cycledays` —— 否決，語義錯。

### D4. 一個事件列表，不並排兩個 calendar

**理由**：Doc1 的實際架構是「學校 event 被 clone 入私人 calendar」，Dickson 一直只看一個日曆。Doc2 的「雙 OAuth 直讀」只是取得資料的方式改變，不是顯示方式。分兩個欄／兩欄並排會製造視覺負擔而不增加資訊。

分組用 `account_key` 近似 💼/🏠：`work` → 💼、`personal` → 🏠。**已知誤差**：私人 calendar 內也可能有工作事項（Doc1 用 vault tag 判斷，dashboard 無此資訊）。接受誤差，不引入手動分類欄位。

### D5. 過渡期以顯示層過濾 clone 副本

**理由**：Phase 4 之前，舊系統仍在把學校 event clone 入私人 calendar，所以雙讀時同一事件會出現兩次（`account_key='work'` 的原始 + `account_key='personal'` 的副本）。

判定規則：`account_key='personal'` 且 title（trim 後完全相同）與某 `account_key='work'` 事件相同，且 `start_time` 差距 ≤ 5 分鐘 → 視為副本，不渲染。

**唔清理 DB 的理由**：Dickson 明確指示「舊 clone 暫不清理」。清理涉及刪除私人 calendar 的 145+ 個事件，風險高且不可逆。

**替代方案**：DB 層刪除副本 —— 否決（不可逆、需 Google API 寫入）。

### D6. relevance filter 在 Phase 2 就開，儘管現時全部是 context

**理由**：Dickson 選擇 A2。因為 Phase 1 沒有實作 relevance 判定，所有事件都是預設 `context`，所以 Upcoming 實際只會顯示 2 日（今日 + 明日 + 後日）。這是**已知且已接受**的後果，不是 bug。Phase 4 Hermes 開始寫 `linked` 之後，Upcoming 才會擴展至 5 日上限。

**風險**：Dickson 打開 dashboard 發現「5 日後的活動不見了」，可能誤以為 sync 壞。緩解：早報（Phase 4）仍然涵蓋完整範圍。

### D7. 任務載入範圍 = 未完成 + 當日完成

**理由**：完成任務永久保留（P1-25），一年會累積 200–500 行。只載入當日完成的，可以讓 Dickson 見到「我今日做完咩」的即時反饋（完成的任務變灰、加刪除線並移至列表最後，仍在畫面內），又不會令 payload 隨時間膨脹。

**替代方案**：近 7 日完成 —— 否決（Dickson 選當日）。全部載入 —— 否決（手機 4G 下載入明顯變慢）。

### D8. 任務排序：pinned → park → priority → due_date → created_at

**理由**：Dickson 明確指定此順序。`park` 排在 `critical` 之前，因為 park 代表「等緊人／等外部」，需要持續提醒。

`due_date` 為 NULL 者排最後；同 `due_date` 時按 `created_at` 由新到舊。

### D9. 事件跨日處理：按重疊判定，不按開始日

**理由**：若按開始日分組，一個 11/26 14:00 – 11/27 12:00 的宿營，在 11/27 會完全消失（因為 11/26 已不在顯示範圍）。Dickson 提出的條件 `start_time < 今日00:00 AND end_time > 今日00:00` 修正了此問題：只要與今日有重疊就顯示，未結束標「進行中」，已結束跟一般已過事件一樣變灰。

**邊界**：用 `end_time > 今日00:00`（嚴格大於）而非 `>=`，排除零長度事件；同時正確處理 Google 全日事件（`end_time` = 翌日 00:00 exclusive）。

### D10. 前端零打字原則（tag 互動）

**理由**：Doc1 §1.1 的核心設計原則「輸入必須零阻力」意味著打字應該發生在 Telegram，不是 dashboard。所以 tag 操作設計成純點選：已選取置前並高亮，點擊 toggle，無 `×` 圖示，無自由輸入框（除「+ 新增」目錄項目）。

**連帶影響**：tag 打錯的清理是靠「移除該 tag 的最後一個使用」令它從目錄消失，不需要重命名功能。

### D11. 錯誤處理分四層，寫入失敗必須 rollback

**理由**：即時儲存（P2-06 儲存 A）意味著誤差會即刻寫入 DB。如果寫入失敗而 UI 沒有回滾，Dickson 會看到一個「已完成」但實際未完成的任務。所以 toast + rollback 是即時儲存的必要配套。

### D13. 非 owner 偵測走 RPC，不在前端硬編 email

**理由**：RLS 對非 owner 的回應是「200 + 空陣列」，與「真係冇資料」無法區分。若在前端硬編 `OWNER_EMAIL` 作對比，email 會出現在 production bundle，任何人 `view-source` 可見。

改為 `public.is_owner()`（`security definer`）回傳 boolean：owner email 只存在 DB（與 RLS policy 同一個值，不會漂移），前端只收 true/false。

**替代方案**：前端硬編 email —— 否決（bundle 曝露）。唔做偵測、只顯示空狀態 —— 否決（非 owner 唔知自己被拒，A2 驗收達不到）。

### D14. Upcoming 為第 2–6 日（修正規格筆誤）

Dickson 原意「today + tomorrow + 5 日 = 共 7 日」，即 Upcoming 覆蓋第 2 至第 6 日。初版 spec 誤寫「第 3 至第 7 日」，會令後日的事件被查到但不渲染（plan agent 的 Conflicts #2）。已修正，查詢窗口同步改為 `start_time < 今日 + 7 日`。

### D12. PWA 無離線快取

**理由**：離線快取會顯示過時的任務與日程。對 Dickson 而言，「睇到舊資料但以為是新資料」比「睇到錯誤」更危險（會漏做事）。所以只做 manifest（加入主畫面），不註冊 service worker。

## Risks / Trade-offs

| 風險 | 影響 | 緩解 |
|---|---|---|
| 全部 relevance 為 `context` → Upcoming 只有 2 日 | Dickson 可能以為 sync 壞 | 明示於本設計；Phase 4 修復 |
| 💼/🏠 用 `account_key` 近似，私人 calendar 的工作事項會誤標 🏠 | 分類不準 | 接受（Doc1 的 vault tag 才是權威，dashboard 無此資訊） |
| clone 副本判定靠 title 字串比對，Hermes/舊系統改過標題會漏判 | 同一事件出現兩次 | 接受（漏判只會多一行，不會漏資料） |
| `tags` 表與 `tasks.tags` 可能短期不一致 | 目錄有 tag 但無任務使用，或反之 | 接受（目錄是「可選項」的權威，任務是「實際使用」） |
| 前端直接寫 DB，RLS 是唯一防線 | 誤寫會即刻生效 | Phase 1 已限定 owner email + 窄 grant；寫入失敗有 rollback |

## Migration Plan

1. 新增 migration `create_tags_and_cycle_days`（2 張表 + RLS + grants），唔改 Phase 1 三張表
2. `supabase db push --remote`（需 Dickson 批准）
3. 前端重寫 + 測試
4. `npm run typecheck` → `npm test` → `npm run build`
5. Push → GitHub Actions 自動部署
6. 驗證：登入、任務 CRUD、tag 目錄、事件分組（用 Phase 1 的測試資料或手動插入）

**Rollback**：migration 的 down 是 `drop table public.tags, public.cycle_days`。前端 rollback = `git revert`（Pages 會重新部署上一個版本）。

## Open Questions

（無 —— 全部 30 個決策點已由 Dickson 批准，見 Phase 2 決策記錄。）
