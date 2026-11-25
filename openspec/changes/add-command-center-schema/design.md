## Context

Dashboard repo（`lammpdagent-dashboard`）現時只有一個 guestbook 用的 `messages` 表，是 Supabase 的連通性測試。Personal Command Center 的 Phase 1 要把資料層建立起來，之後 Phase 2（前端）與 Phase 3（n8n 同步）才有基礎。

Dickson 已逐項批准 25 個 Phase 1 項目，完整清單在 `Documents/Agent/projects/Personal Command Center - Phase 1 決策記錄.md`。本 design 只解釋「為何」這樣設計，逐項批核紀錄以該檔案為準。

技術環境：Supabase（project `tmgnqofsyyaigilqkonv`，ap-southeast-1，Postgres 17）、Supabase CLI 3.3、repo 為 public（GitHub Pages）。單一使用者（Dickson），owner email 為私人 Gmail。

## Goals / Non-Goals

**Goals:**

- 三張表（`tasks`、`events`、`system_meta`）連同 RLS、索引、trigger、Realtime 一次建立
- 在 DB 層保證：非 owner 讀唔到、前端不能實體刪除任務、事件只能由 service_role 寫
- 令 Phase 2 前端可以「直接讀寫 Supabase、零 token」
- 令 Phase 3 同步有冪等 upsert 與逐帳號狀態記錄

**Non-Goals:**

- 不寫任何前端程式（Phase 2）
- 不寫任何 n8n workflow（Phase 3）
- 不遷移 vault 資料（Phase 5）
- 不實作 `relevance` / `day_cycle` 的判定邏輯（只建欄位，預設 `context` / NULL）

## Decisions

### D1. 三張獨立表，而非單一 `items` 表

任務與日曆事件的生命週期完全不同：任務有狀態機與 soft delete，事件是外部資料的鏡像（只讀、upsert）。合併會令 RLS 與約束互相牽制。

**替代方案**：單表 + `type` 欄位。否決原因：`tasks` 需要 owner 寫入權、`events` 必須禁止 owner 寫入，同一張表無法用單一 policy 表達。

### D2. `events.id` 用 `{account_key}_{google_event_id}` 字串，而非 UUID

同步是 upsert。用可預測的字串主鍵，`ON CONFLICT (id) DO UPDATE` 天然冪等，唔需要額外查詢。

**替代方案**：UUID + `UNIQUE(account_key, google_event_id)`。兩者都可行；選字串 id 是因為偵錯時一眼看出屬於哪個帳號。

### D3. RLS 用 `auth.jwt() ->> 'email'`，單一 owner

Google 帳號 email 不可被用戶自行更改，`email` claim 由 Google token 直接帶入，前端偽造不到。單一 email 最易讀。

**已知曝露**：email 會出現在 migration SQL，而 repo 是 public。但 `git log --format='%ae'` 早已公開同一 email，邊際曝露為零（Dickson 已確認接受）。

**替代方案**：`auth.uid()` UUID。否決原因：Dickson 未登入過 Supabase Auth，現時無 UUID 可填，要拆成兩步。

### D4. `tasks` 用 soft delete，並移除 owner 的 DELETE 權限

Dickson 明確選擇。關鍵是**同時移除 DELETE policy**：只加 `deleted_at` 而保留 DELETE 權，等於「前端自願唔刪」，一次 code 錯誤就會真刪。

**替代方案**：真 DELETE（我原本建議，被否決）。真刪除仍然可由 service_role 執行，唔會完全失去能力。

### D5. `events` 不刪過期，取消用標記

Dickson 選 C + B1。同步只做兩件事：upsert 現存事件、把本次抓不到的事件標記 `cancelled_at`。**不做任何基於 `last_synced_at` 的時間清理**。

理由：Doc2 原本的 `DELETE WHERE last_synced_at < sync_batch_time` 會在單次同步部分失敗時大量誤刪（R1）。

**代價**：`events` 會持續累積；14 日 window 以外的歷史事件永久凍結（Google 上刪了也不會反映）。Dickson 接受。

### D6. `system_meta` 每個來源一行

單一 `calendar_sync` key 加單一 `status` 無法表達「私人成功、學校失敗」。每個來源一行令狀態有 CHECK 約束，且前端讀 `select *` 就看到全部。

`detail JSONB` 存 `fetched` / `prev_fetched`，供 Phase 3 判斷「抓 0 筆是否異常」。

**替代方案**：單 key + JSONB（Doc2 原設計）。否決原因：單一 `status` 表達不到混合狀態。

### D7. `status` 三態：`todo` / `done` / `park`

`park` 語義為「等緊人／等外部」，早報仍要顯示（格式留 Phase 4）。Doc1 現役的 `#waiting` 本質上是 section 分類，改名為 `park` 並提升為正式狀態。

### D8. `updated_at` 由 trigger 維護

三個寫入者（前端、Hermes、n8n）。application 層維護必然遺漏，且遺漏無聲。

### D9. `events` 設 `REPLICA IDENTITY FULL`

現時前端設計不使用 Realtime filter（訂閱全部、前端自行篩選），所以當前不設也不會壞。但將來一加 filter，DELETE 會靜靜失效，而且症狀隱蔽（UPDATE 正常、只有 DELETE 不動）。成本近乎零，故加上。

### D10. Realtime `ADD TABLE` 用 idempotent DO block

Supabase migration 每個檔案一個 transaction，正常流程不會重跑。DO block 只防手動在 SQL Editor 重複執行。低價值但零成本。

### D11. 索引三個全加

現時表細，Postgres 會用 seq scan，索引零效益。加的原因是成本只有一行 SQL、無前端成本，而資料累積後自動生效。

### D12. `messages` 表在同一個 migration 內 DROP

**BREAKING**。DROP 之後現有前端（`src/lib/repository.ts` 查 `messages`）會在運行時失敗，dashboard 顯示載入錯誤，直到 Phase 2 重寫。

**替代方案**：延後至 Phase 2 才 DROP。否決原因：留下「已廢棄但仍有資料」的表會令 Phase 2 期間的 schema 比較混亂；且 guestbook 資料無保留價值（2 行測試資料）。

Dickson 已知悉並接受中間狀態。

## Risks / Trade-offs

- **[R1] Phase 1 完成後 dashboard 顯示錯誤** → 已知並接受；Phase 2 會重寫前端。緩解：Phase 1 完成後唔 push 前端程式碼（只 `db push`），靜態檔仍是舊 build，錯誤只出現在資料載入。
- **[R2] 學校帳號不能登入 dashboard**（單一 email 政策）→ 如果日後要在手機用學校帳號登入，只需 `ALTER POLICY` 加第二個 email，不影響資料。
- **[R3] `events` 永久累積** → 以每年 800–1500 行估算，十年約 1.5 萬行，對 Postgres 完全無壓力。
- **[R4] `REPLICA IDENTITY FULL` 增加 WAL 體積** → 以現時資料量不可感知。
- **[R5] `detail JSONB` 無 schema 約束** → Phase 3 寫入時要保持 `{fetched, prev_fetched}` 格式；前端要容忍欄位缺失。
- **[R6] email 出現在 public repo 的 migration** → 已接受（git history 已公開同一 email）。

## Migration Plan

單一 migration 檔案 `supabase/migrations/<timestamp>_create_command_center_tables.sql`，順序：

1. `CREATE TABLE tasks` / `events` / `system_meta`（含所有 CHECK 約束）
2. 索引（3 個）+ `tasks.source_ref` partial unique index
3. `tasks.updated_at` trigger + function
4. `ALTER TABLE events REPLICA IDENTITY FULL`
5. 啟用 RLS + 建立 policy（tasks: select/insert/update；events: select；system_meta: select）
6. `REVOKE ALL` 後授予精確權限（Supabase 對 public schema 新表預設授予 ALL）
7. 以 DO block 將三張表加入 `supabase_realtime`
8. `DROP TABLE public.messages`

部署：

```bash
supabase db push --remote --dry-run   # 先確認只有一個 migration
supabase db push --remote --yes
supabase db diff --remote --schema public   # 應為 no changes
```

Rollback：整個 migration 在單一 transaction 內，失敗會自動 rollback。若成功後要回退，需另一個 migration（DROP 三張表 + 重建 `messages` — 但 guestbook 資料不重建，價值為零）。

驗證（對應 acceptance criteria）：

- anon key 查三張表 → **401 permission denied 或 0 行**（兩者都代表讀唔到；`anon` 冇任何 grant）
- 非 owner session → 全部 0 行
- owner session → tasks 可讀寫、events/system_meta 只讀、DELETE 被拒
- 手動 UPDATE 一筆 task → `updated_at` 改變
- `pg_publication_tables` 見三張表
- `pg_policies` 見 policy 數量符合（tasks 3、events 1、system_meta 1）

## Open Questions

無 — 25 項已全部由 Dickson 批准。
