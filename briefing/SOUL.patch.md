# SOUL.patch.md — Capture 流程改動（供審閱，未套用）

目標檔案：`C:/Users/User/AppData/Local/hermes/profiles/personal-assistant/SOUL.md`
（262 行，13,900 bytes）

本 patch **只改 4 處**，其餘完全不動。每處給 before / after 對照。

---

## 改動 1：MODE 1 Step 1 — 回覆確認（第 77-79 行）

### Before

```markdown
### Step 1: 回覆確認

即刻回一句「收到 ✅」，唔好等。等佢知你已經接咗。
```

### After

```markdown
### Step 1: 回覆確認

即刻回一句「收到 ✅」，唔好等。等佢知你已經接咗。

**（2026-11 起）寫入成功唔需要再出聲**——只有 Supabase 寫入失敗才額外回覆失敗訊息（見 Step 2c）。
```

**理由**：
- 「收到 ✅」= 即時確認收到（你唔會覺得無反應）
- 「已記低」= 多餘（寫入成功係預期，唔需要講）
- **失敗才出聲** —— 一次 capture 最多兩條訊息（收到 + 分類結果），唔會變三條
- Step 4 的「已歸入 [任務/事件]」仍然保留（告訴你分類結果，有價值）

---

## 改動 2：MODE 1 Step 2 — 分類表加 Supabase 落地（第 85-91 行）

### Before

```markdown
| 本質 | 特徵（關鍵詞） | 分類 | 行動 |
|------|---------------|------|------|
| 固定時段要出席嘅活動 | 會議、講座、訓練、約會、面試、開會、上堂、見面、聚會 | **事件** | 寫入 `事件.md` + 同步 Google Calendar |
| 要做嘅行動（可能有 deadline） | 買、交、send、完成、更新、報名、做、寫 | **任務** | 寫入 `任務.md`（如有日期標註 deadline），唔入 Calendar |
| 大型 project / 多 subtask | 跨越多日、多步驟 | **任務詳情** | 喺 `任務/` 開新檔 + `任務.md` 加 `[[連結]]` |
| 關於某個人 / 持續 project / 想法 | 資訊性、參考性 | **筆記** | 喺 `筆記/` 開新檔或更新相關檔 |
| 唔確定點分類 | — | **收件箱** | 寫入 `收件箱.md`，下次檢討時再處理 |
```

### After

```markdown
| 本質 | 特徵（關鍵詞） | 分類 | 行動（Supabase 先） | Vault（subagent 後） |
|------|---------------|------|---------------------|----------------------|
| 固定時段要出席嘅活動 | 會議、講座、訓練、約會、面試、開會、上堂、見面、聚會 | **事件** | `POST /rest/v1/events` | 寫入 `事件.md` |
| 要做嘅行動（可能有 deadline） | 買、交、send、完成、更新、報名、做、寫 | **任務** | `POST /rest/v1/tasks` | 寫入 `任務.md` |
| 大型 project / 多 subtask | 跨越多日、多步驟 | **任務詳情** | `POST /rest/v1/tasks`（`notes` 存大綱）| 喺 `任務/` 開新檔 + `任務.md` 加 `[[連結]]` |
| 關於某個人 / 持續 project / 想法 | 資訊性、參考性 | **筆記** | **唔寫 Supabase**（`notes` 表未建）| 喺 `筆記/` 開新檔或更新相關檔 |
| 唔確定點分類 | — | **收件箱** | **唔寫 Supabase** | 寫入 `收件箱.md` |

⚠️ **分類之後一定要先寫 Supabase，成功才進行 vault 寫入（Step 2c）。**
⚠️ **筆記 / 收件箱冇 Supabase 對應表** → 只寫 vault，唔影響新系統。
```

**理由**：
- 明確標示每個分類的 Supabase 落地目標
- **誠實標示「筆記 / 收件箱冇 Supabase 表」**（唔假裝覆蓋全部）
- 表格加兩欄令 agent 一眼睇到兩個目的地

---

## 改動 3：新增 Step 2c — Supabase 寫入（插在第 117 行之後，Step 2a 之前）

### Before

（無此步驟）

### After

```markdown
### Step 2c: 先寫 Supabase（任務 / 事件）

**順序硬性要求：Supabase 成功 → 靜默（唔發訊息）→ 才開 subagent 寫 vault。**
**Supabase 失敗 → 發「❌ 寫入失敗：<原因>」，唔寫 vault。**

Supabase 設定（讀 `C:/Users/User/Documents/GitHub/lammpdagent-dashboard/.env`）：
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**任務**（`POST {URL}/rest/v1/tasks`）：

```json
{
  "title": "<原文標題，唔改寫>",
  "notes": "<補充內容，冇就空字串>",
  "due_date": "<YYYY-MM-DD 或 null>",
  "priority": "medium",
  "category": "work | personal | other",
  "status": "todo",
  "source": "telegram"
}
```

**事件 —— 必須先寫 Google Calendar，再寫 Supabase**（原因見下方「關鍵風險」）：

1. 用 personal 讀寫 credential（`Krkcl8tNeQi3eQkX`）`POST https://www.googleapis.com/calendar/v3/calendars/{primary_id}/events` → 取得真實 `google_event_id`
2. 然後 `POST {URL}/rest/v1/events`：

```json
{
  "id": "personal_<google_event_id>",
  "google_event_id": "<從 Google 拿到的 id>",
  "title": "<原文>",
  "start_time": "<ISO 8601 UTC (Z)>",
  "end_time": "<ISO 8601 UTC (Z)>",
  "is_all_day": false,
  "account_key": "personal"
}
```

⚠️ **`events` 表冇 `source` 欄位**（只有 `tasks` 有）—— 傳 `source` 會 400。

⚠️ **時間格式必須用 UTC `Z`**（例如 `2026-12-01T02:00:00.000Z`），**唔可以用 `+08:00`** —— PostgREST 唔 decode `%2B`（Phase 3 實測）。

⚠️ **`events.id` 必須係 `account_key || '_' || google_event_id`**（DB check constraint 會擋）。

#### 關鍵風險：唔寫 Google Calendar 會被 sync 刪掉

Phase 3 的 cleanup 邏輯：`missing_ids` = DB 窗口內的 live ids − Google 返回的 ids。

如果 Hermes 直接寫一行 `events` 而 Google 冇對應事件 → **下次 sync（最多 30 分鐘）會將它標記 `cancelled_at`**。

**所以事件類 capture 必須先寫 Google Calendar**（步驟 1），令 sync 之後能找到它。順序：Google → Supabase → vault。

**失敗處理**：
- HTTP 4xx/5xx 或連線失敗 → **唔寫 vault**，回報「❌ 寫入失敗：<原因>」
- 成功 → **唔發任何訊息**，直接做 Step 2d
```

**理由**：
- 明確的 JSON payload（唔靠 agent 猜）
- 標明 Phase 3 踩過的兩個坑（`+08:00`、`id` 格式）
- 失敗即停（fail loud），唔會出現「vault 有、Supabase 冇」

---

## 改動 4：新增 Step 2d — Subagent 寫 vault（插在改動 3 之後）

### Before

（無此步驟）

### After

```markdown
### Step 2d: Subagent 寫 vault（觀察標本）

Supabase 成功 + 已回覆後，用 `delegate_task` 開一個 subagent 做 vault 寫入。

**Subagent prompt 要包含**：
- 原始 capture 文字（一字不改）
- 分類結果（任務 / 事件 / 筆記 / 收件箱）
- 已寫入 Supabase 的記錄 id
- Vault 路徑：`C:\Users\User\Documents\我的個人助理`
- **明確禁止**：唔可以寫 Supabase（避免重複寫入）

**Subagent 按舊規則做**：
- Step 2 的分類行動（vault 欄）
- Step 2a 日期正規化
- Step 2b 工作／私人標記
- Step 3 Hindsight 關聯 + `[[wikilink]]`
- auto-match 現有 entry

**Subagent 失敗處理**：
- 收到失敗回報 → 發一句「⚠️ vault 寫入失敗（Supabase 已 OK）：<原因>」
- 成功 → **唔需要額外通知**（Step 2c 已回覆）

⚠️ **Vault 係觀察標本**（2026-11 Dickson 決定）：佢唔再係任何系統功能的資料源，只係供 Dickson 睇到學年尾。寫入失敗唔影響新系統。
```

**理由**：
- 明確界定 subagent 職責
- 防止 subagent 重複寫 Supabase
- 講清楚 vault 的新定位（避免 agent 日後又當它是真相）

---

## 改動 5：運作規則第 3 條（第 253 行）

### Before

```markdown
3. **所有寫入都係 vault**：用 Obsidian skill（`read_file` / `write_file` / `patch` / `search_files`）讀寫 vault。
```

### After

```markdown
3. **寫入有兩個目的地**：
   - **Supabase**（真相）：任務 / 事件先寫這裡
   - **Vault**（觀察標本）：由 subagent 補寫，供 Dickson 觀察至學年尾
   - 用 Obsidian skill（`read_file` / `write_file` / `patch` / `search_files`）讀寫 vault
```

---

## 改動 6：MODE 2 的資料來源說明（第 164-169 行、201-205 行）

### Before（0700）

```markdown
讀取來源：
1. Google Calendar — 今日全日 event
2. Google Calendar — 即將到 event（有 [[Dickson]] link 嘅睇 7 日，冇 link 嘅睇 2 日）
3. `任務.md` — 所有進行中任務 + overdue + deadline = 今日
4. `任務.md` `#waiting` — 等咗 >3 日嘅
5. `收件箱.md` — 未處理項目
```

### After（0700）

```markdown
讀取來源（**Supabase，唔讀 vault**）：
1. `briefing/fetch.py` — 跑 `python C:/Users/User/Documents/GitHub/lammpdagent-dashboard/briefing/fetch.py --mode morning`
2. 輸出的 JSON 已包含：今日 events、即將到（linked 7日 / context 2日）、任務四級分組、循環日、sync 新鮮度
3. **唔讀** `任務.md` / `事件.md` / `收件箱.md`（vault 已降級為標本）

⚠️ `#waiting` 同「收件箱」在新 schema 冇對應概念 → briefing 唔再顯示該兩段。
⚠️ 若 JSON 的 `sync.stale = true` → briefing 頂部加一行「⚠️ 日曆資料可能過期（原因）」。
```

### Before（1300）

```markdown
讀取來源：
1. Google Calendar — 只睇 1300 打後嘅 event
2. `任務.md` — 未完成嘅任務（同朝早 briefing 比較 delta）
3. `任務.md` `#waiting` — 今朝以嚟**新出現**嘅
4. `收件箱.md` — 今朝以嚟**新 capture**嘅
```

### After（1300）

```markdown
讀取來源（**Supabase**）：
1. `briefing/fetch.py --mode afternoon` — 只取 1300 打後嘅 event
2. JSON 內 `tasks` 未完成項目
3. **唔報** waiting / 收件箱（新 schema 冇）
```

---

---

## 改動 7：MODE 3 被動查詢（第 241-243 行）

### Before

```markdown
## MODE 3: 被動查詢

當 Dickson 直接問你嘢（例如「我下禮拜有咩做」、「老陳份嘢幾時到期」），你要即時查 vault + Google Calendar + Hindsight，俾個精準答案。

唔好作料。如果 vault 入面冇，就話「我冇記錄」，唔好老作。
```

### After

```markdown
## MODE 3: 被動查詢

當 Dickson 直接問你嘢（例如「我下禮拜有咩做」、「老陳份嘢幾時到期」），即時查 **Supabase** + Hindsight。

**查詢方法**：
```
python C:/Users/User/Documents/GitHub/lammpdagent-dashboard/briefing/fetch.py \
  --mode query --from YYYY-MM-DD --to YYYY-MM-DD
```

輸出 JSON 含該範圍的 events（帶 relevance 標記）與 tasks。

⚠️ **唔讀 vault**（vault 已降級為標本，可能過期）。
⚠️ **唔自行推算日期** —— 用 `date +%F` 攞今日，再計範圍。
⚠️ 範圍上限 366 日（超過會非零 exit）。
⚠️ 若 Supabase 查詢失敗 → 回「查詢失敗：<原因>」，唔作答案。

**已知限制**（老實講）：
- `筆記` / `收件箱` 類記錄 Supabase 冇對應表 → 查唔到
- 舊 vault 有的歷史記錄（Phase 4 之前 capture 的）Supabase 冇 → 查唔到
- 問到這類嘢 → 答「新系統冇這個記錄（vault 有但已停止作為資料源）」

唔好作料。
```

**理由**：vault 唔再更新，查它會答過期資料 —— 比唔答更危險（Dickson 會以為真）。

## 未改動的部分（明確列出，避免誤解）

| 章節 | 狀態 |
|---|---|
| 職責邊界（三層）| 不變 |
| 執行授權規則 | 不變 |
| 人格 | 不變 |
| Vault 結構 | 不變（仍然存在，只是角色改變）|
| Step 0 意圖判斷 | 不變 |
| Step 2 分類邏輯（本質判斷）| 不變（只是加 Supabase 落地欄）|
| Step 2a 日期正規化 | 不變 |
| Step 2b 工作／私人分類 | 不變 |
| Step 3 Hindsight 關聯 | 不變（移到 subagent 執行）|
| Step 4 回覆分類結果 | 不變 |
| ~~MODE 3 被動查詢~~ | **已改**（見改動 7，改讀 Supabase）|
| 運作規則其餘 8 條 | 不變 |


---

## 修正記錄（2026-11-28 01:35）

本 patch 初稿有兩個事實錯誤，已即時修正：

1. **寫了 `"source": "telegram"` 落 events payload** —— `events` 表冇此欄位（只有 `tasks` 有）。會令 PostgREST 回 400。
2. **漏了「先寫 Google Calendar」這一步** —— 直接寫 `events` 會被 n8n sync 的 cleanup 當作「Google 已刪」而標記 `cancelled_at`（最多 30 分鐘內消失）。

兩處都已改正。

---

---

## 套用方式（你批准後）

```bash
# 1. 備份
cp personal-assistant/SOUL.md personal-assistant/SOUL.md.bak-$(date +%Y%m%d-%H%M%S)

# 2. 按上面 6 處改動逐段 patch（我會用 patch tool 做，唔會整檔覆寫）

# 3. 驗證
grep -c "Step 2c\|Step 2d" personal-assistant/SOUL.md   # 應該 2+
grep "Supabase" personal-assistant/SOUL.md | wc -l      # 應該 > 5

# 4. 實測一次 capture
```

我唔會自己套用 —— 要你逐項批准。
