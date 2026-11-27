## Context

Phase 3 的唯一目標：令 `events` 表有資料，dashboard 的事件區可用。設計受三個已定事實約束：

1. **實測**：personal 3 個日曆 180 events / 90 天；work 6 個日曆（排除教師生日）165 events / 90 天
2. **實測**：Day event 在 work「2. 學生相關」，格式 `DayＥ`（**全形字母**）；personal primary 另有 `Day E（第9循環週）`（半形，屬舊 clone）
3. **已定決策**（P3-A 至 P3-G）：雙層排程、work 派生 Day、6 個日曆、backfill 2026-08-01、唔做 REPLICA IDENTITY、唔重試

## Goals / Non-Goals

**Goals**
- dashboard 事件區有真實資料，30 分鐘內反映 Google 變更
- 同步失敗時 dashboard 能顯示警告（P2-16/17 已定的前端行為）
- 穩定狀態下每次只寫 0–5 行，唔係全量重寫

**Non-Goals**
- 唔寫 Google Calendar（Phase 4）
- 唔做 push notification（P3-A 已否決）
- 唔做 realtime 之外的即時性保證
- 唔遷移 vault（Phase 5）

## Decisions

### D1 — 雙層排程

| cron | 窗口 | 理由 |
|---|---|---|
| `0 * * * *` | 未來 90 天 + 過去 1 天 | 遠期事件幾乎不變，每小時足夠 |
| `30 * * * *` | 未來 30 天 + 過去 1 天 | 近期事件常改，30 分鐘更新 |

實測成本：90 天 349 events / 4.4 秒；30 天 180 events / 4.0 秒。每日 48 次執行 ≈ 3.4 分鐘運算。

### D2 — cleanup 的目標係「本次抓取中失蹤的 id」，唔係「last_synced_at 舊」

**這是本 change 最關鍵的安全規則，而「四條件」版本係錯的。**

#### 為什麼 `last_synced_at < batch_time` 唔夠

D3 的增量邏輯令未變更的事件**唔會被寫入**，所以它們的 `last_synced_at` 永遠停留在舊 batch。若 cleanup 以 `last_synced_at < batch_time` 為條件，**第二次 sync 起，窗口內所有未變事件都會被判為 stale** → 全批標 `cancelled_at`。

四個條件（`account_key` + 窗口 + `last_synced_at`）係**必要但不充分**。

#### 正確做法：diff 出 missing ids

```
db_ids      = SELECT id FROM events WHERE account_key = :acct
                AND start_time >= :window_start AND start_time < :window_end
                AND cancelled_at IS NULL
google_ids  = 本次 Google 抓取返回的所有 id
missing_ids = db_ids − google_ids
```

然後只對 `missing_ids` 執行：

```sql
UPDATE public.events
SET cancelled_at = :batch_time
WHERE account_key = :account
  AND id = ANY(:missing_ids)
  AND start_time >= :window_start     -- 防禦性：唔碰窗口外
  AND start_time  < :window_end
  AND cancelled_at IS NULL            -- 防重複寫
```

**絕對唔用 `DELETE`** —— `calendar-events` spec 要求事件永久保留，取消只以 `cancelled_at` 表達。

#### 額外的自癒

因為 select 帶 `cancelled_at IS NULL`，若某事件曾被誤標，下次它在 Google 重現時會重新出現在 `google_ids` → upsert 時應同時把 `cancelled_at` 設回 NULL（Google 有就係存在）。

### D3 — 增量寫入（只寫有變更的行）

1. sync 前查 `select id, last_synced_at, cancelled_at from events where account_key = :account and start_time within window`
2. 對每個 Google event：
   - `id` 不存在 → INSERT
   - Google 回應的 `updated` > DB 的 `last_synced_at` → UPDATE
   - `db.cancelled_at IS NOT NULL`（曾被標取消）→ UPDATE 並把 `cancelled_at` 設回 NULL
   - 其餘 → 跳過
3. 穩定狀態下每次寫 0–5 行

**唔需要為 `updated` 加欄位**：`events` 的 `last_synced_at` 就是「上次確認這行與 Google 一致的時間」，可直接與 Google 的 `updated` 比較。

### D4 — `cycle_days` 派生自 work「2. 學生相關」

- 只讀該單一日曆（唔讀 personal 的 clone）
- regex **必須同時支援全形與半形**：`^Day\s*([A-FＡ-Ｆ])`
- 全形 `Ａ-Ｆ`（U+FF21–FF26）需轉換為半形 `A-F`
- 跳過非上課日（無 Day event 的日子不寫入，前端按「今日」查詢，無記錄即不顯示）

### D5 — 排除「5. 教師生日」

在日曆清單過濾：`summary === '5. 教師生日'` → 跳過。其餘 6 個全讀（含 0 事件的 3 個，成本可忽略）。

### D6 — 首次 backfill

`timeMin = 2026-08-01T00:00:00Z`，`timeMax = now + 90d`。實測 1,573 events / 5.3 秒 / 1.63 MB。一次性；之後按 D1 窗口。

backfill 用同一個 workflow，加一個 `isBackfill` 分支（n8n 手動觸發一次）。

### D7 — 失敗處理：唔重試

- Google token 過期 → n8n Google Calendar node 自動 refresh
- 其他失敗 → 寫 `system_meta`（`status='error'`、`detail` 含錯誤訊息、`last_run_at`），等下一個排程
- **不設 n8n retry policy**

理由：排程間隔 30 分鐘，重試的邊際價值低於複雜度成本。

### D8 — `REPLICA IDENTITY FULL` 已存在（P3-F 的決定係零動作）

**事實更正**：Phase 1 的 migration `20261126004259_create_command_center_tables.sql` 第 121 行已經執行 `alter table public.events replica identity full;`，遠端實測 `events.relreplident = 'f'`。

P3-F 當時的討論基於「未做」的錯誤事實（control plane 用大寫 `REPLICA IDENTITY` grep 小寫檔名而漏檢）。Dickson 的最終決定「保持 DEFAULT / 唔做」在實際層面等於 **零動作** —— 已是 FULL，而 `calendar-events` spec 亦早已要求「事件變更可即時推送完整行」。

**本 change 唔需要任何 ALTER。**

其餘 4 張表（`tasks` / `system_meta` / `tags` / `cycle_days`）維持 DEFAULT `'d'`，符合設計（前端用主鍵即可）。

### D9 — workflow 版控

n8n workflow JSON 匯出至 `n8n/workflows/calendar-sync.json`，進 git。理由：Phase 3 的同步邏輯若只存在 localhost docker，instance 消失即無法重建（PROJECT.md §7 D7）。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| cleanup 條件寫錯 → 誤刪 30–90 天事件 | D2 明寫三個條件；Phase 3 驗收要求「先跑一次 30 天 sync，確認 90 天資料未被刪」 |
| 半點與整點 sync 併發（同一事件被兩邊寫）| 兩者相隔 30 分鐘，且 upsert 冪等；最壞情況多一次寫入 |
| work credential 仍為 read-write（D9 風險）| workflow 內 work 分支只用 `getAll` operation；code review 檢查 credential 綁定 |
| 全形字母 regex 寫錯 → cycle_days 漏一半 | 驗收要求：Day 記錄數 ≥ 42（90 天） |
| n8n workflow 未版控 → instance 消失即失去邏輯 | D9 匯出 JSON 進 git |

## Migration Plan

1. 建 workflow（n8n UI 或 API），先手動跑一次 backfill
2. 驗證 `events` 行數 ≈ 1,500+、`cycle_days` ≈ 42+
3. 抽樣核對 3 個事件與 Google Calendar 一致
4. 啟用排程
5. 等 30 分鐘，確認第二次執行只寫少量行（增量生效）
6. 在 Google 刪一個未來事件，等 30 分鐘，確認 DB 標 `cancelled_at`

**Rollback**：停用 workflow 即可；`events` 資料保留無害。刪除邏輯不會影響其他表。

### D10 — 三種觸發方式（排程 ×2 + 手動）

單靠兩個 Schedule Trigger 做唔到 backfill 與測試（4.3 / 4.4 / 6.5 都需要即時跑一次）。所以 workflow 需要 **三個入口**：

| 觸發 | 參數 | 用途 |
|---|---|---|
| Schedule `0 * * * *` | `days=90`, `isBackfill=false` | 整點常規 |
| Schedule `30 * * * *` | `days=30`, `isBackfill=false` | 半點常規 |
| **Manual Trigger** | 由節點上的 preset 決定 | backfill / 測試 |

Manual 分支用一個 Set 節點提供三個 preset：`backfill`（`timeMin=2026-08-01`）、`days90`、`days30`。手動執行時在 n8n UI 揀對應 preset。

### D11 — 寫入用 HTTP Request 直打 PostgREST，唔用 Supabase node

理由：需要 `on_conflict` upsert（`Prefer: resolution=merge-duplicates`）、多條件 PATCH（`in` / `gte` / `lt` / `is.null`）、以及讀取回應的 `Content-Range` 做計數。n8n 內建 Supabase node 唔支援這些組合。

- Base URL：`{SUPABASE_URL}/rest/v1/...`
- Auth：service_role key 放 n8n 的 **Header Auth credential**（JSON 內只存 credential 引用，唔會出現明文 secret）
- `Prefer: return=representation` 用於需要讀回結果的寫入

### D12 — 錯誤處理：fail-closed

高風險節點設 `onError = continueErrorOutput`，錯誤輸出接到共用 error router（按節點名前綴 `P:` / `W:` 判斷係邊個帳號失敗）→ 寫 `system_meta`（`status='error'` + `detail`）→ 該帳號的主鏈即斷。

**fail-closed 的含義**：Supabase 寫入失敗 → 同一帳號的 cleanup 不執行（spec 要求），因為 cleanup 節點在寫入節點的下游，寫入失敗則鏈斷。

另一個帳號的鏈完全獨立（credential 綁在各自節點上），所以互不影響。

### D13 — repo-first 的 workflow 版本管理

Workflow JSON 以 repo 為真相來源：

1. 先寫 `n8n/workflows/calendar-sync.json`
2. `n8n import:workflow --input=... --activeState=fromJson`
3. 日後修改一律改 repo 的 JSON，再 import 覆蓋
4. 唔在 n8n UI 直接改（避免漂移）

理由：若 n8n instance 消失，repo 的 JSON 可以完整重建（PROJECT.md §7 D7）。

### D14 — work credential 用 `googleOAuth2Api`（readonly），唔用 `googleCalendarOAuth2Api`

**背景**：`googleCalendarOAuth2Api` 的 `scope` 欄位係 `type: 'hidden'` 且 `scopes` 陣列寫死在 `n8n-nodes-base` 原始碼內（`calendar` + `calendar.events`）。n8n 的 `oauth.service.js:388` 有邏輯：

```js
const userCanEditScope = GENERIC_OAUTH2_CREDENTIALS_WITH_EDITABLE_SCOPE.includes(credential.type)
if (decryptedDataOriginal?.scope && credential.type.includes('OAuth2') && (credential.isManaged || !userCanEditScope))
    delete decryptedDataOriginal.scope;
```

`googleCalendarOAuth2Api` 唔在 `GENERIC_OAUTH2_CREDENTIALS_WITH_EDITABLE_SCOPE` 內 → 自訂 scope 會被刪除 → 用寫死的讀寫 default。

**解法**：work 帳號改用 `googleOAuth2Api`（在可編輯清單內），該 type 已預設所有 Google endpoint（`authUrl` / `accessTokenUrl` / `authQueryParameters` / `authentication=body`），只需填 `clientId` / `clientSecret` / `scope`。

**實測驗證（2026-11-27）**：
- credential `GCalWorkRO000001`，scope = `https://www.googleapis.com/auth/calendar.readonly`
- 授權後 token scope 與 configured 一致
- 讀取 `calendarList` → 成功，7 個日曆
- 寫入 `PATCH /calendars/primary/events/{nonexistent}` → **HTTP 403 "Request had insufficient authentication scopes"**

**⚠️ 實作約束**：`googleOAuth2Api` 唔係 Google Calendar node 的原生 credential type。work 分支的讀取必須用 **HTTP Request node** 直接打 `https://www.googleapis.com/calendar/v3/...`，唔可以用 Google Calendar node。

personal 帳號維持 `googleCalendarOAuth2Api`（`Krkcl8tNeQi3eQkX`），可以用 Google Calendar node。

**兩個 credential 的分工**：

| 帳號 | Credential | Type | Scope | 讀取方式 |
|---|---|---|---|---|
| personal | `Krkcl8tNeQi3eQkX` | `googleCalendarOAuth2Api` | read-write（不變，因為 personal 係自己日曆）| Google Calendar node |
| work | `GCalWorkRO000001` | `googleOAuth2Api` | **readonly** | HTTP Request node |

## Open Questions

（無 —— P3-A 至 P3-G 已全部由 Dickson 決定，2026-11-27。C1–C5 的 design 修正係 plan 階段發現的實作缺口，不改變已批決策。）
