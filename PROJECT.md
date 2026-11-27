# PROJECT.md — 專案地圖與文件治理

> 呢份文件答一個問題：**「我想知 X，應該去邊度搵？」**
> 讀者：未來嘅 agent（主要）、Dickson（次要）。
> 它唔記錄功能細節，只記錄「邊份文件係權威」同「幾時要更新」。
>
> **呢份文件自己都會錯。** 它係 T3，唔可以推翻 T1／T2——如果你發現它同現實唔一致，**改它**，唔好為遷就它而扭曲現實。
> 最後核對：2026-11-27（每次核對完 §2.2 同 §6 就更新呢個日期；日期太舊 = 呢份文件不可信）
>
> **點用（給 Dickson）**：唔需要讀完全文。記三件事就夠——① 邊份文件算數：§2.1；② 每個 Phase 收工：跑 §5；③ 有咩知而未清：§7。

---

## 1. 專案是什麼

**Personal Command Center** —— Dickson 的個人任務 + 日曆儀表板。

- 入口：Telegram（Phase 4）／瀏覽器（已上線）
- 資料層：Supabase Postgres（雲端 + 本地 docker）
- 同步：n8n 定時拉 Google Calendar（Phase 3，未實作）
- 前端：Vite + TypeScript 靜態站，部署 GitHub Pages
- 硬約束：**$0/月**（免費額度），單一 owner，繁體中文 UI

五個 Phase：0 可行性 → 1 DB/Auth ✅ → 2 前端 ✅ → 3 Calendar Sync → 4 Telegram/Briefing → 5 vault 遷移

---

## 2. 資產登記（Asset Registry）

### 2.1 權威級別定義

| 級別 | 意思 | 衝突時誰贏 |
|---|---|---|
| **T1 事實** | 系統實際行為（code、tests、migration、`.env`） | 贏過 T3–T6；**對 T2 唔自動贏**（見補充 1） |
| **T2 需求** | 系統應該點做 | 贏過 T4–T6；**對 T3 唔自動贏**（見補充 3） |
| **T3 規則** | 點樣開發 | 贏過 T4–T6 |
| **T4 決策** | 點解揀呢個做法（已凍結） | 歷史參考，唔可以推翻 T1/T2 |
| **T5 背景** | 專案來龍去脈 | 唔參與裁決 |
| **T6 臨時** | 工作檔，可隨時刪 | 唔參與裁決 |

**裁決補充（三種真實會撞到的情況）**

1. **T1 vs T2 唔係「邊個贏」**，係兩個唔同問題：T1 答「而家係咩」，T2 答「應該係咩」。兩者唔一致 = **有一個缺陷**。按 spec 有冇寫落去分三條路：
   - spec 寫 A、code 做 B，而**冇**任何決策記錄／change 批准過 B → **停手問 Dickson**（多數係 bug，或者需求被偷偷改）。
   - spec 寫 A、code 做 B，而決策記錄有批准 B → spec 過時，改 spec 並註明依據。
   - spec **冇提**呢個行為（沉默）→ code 就係現狀：補寫入 spec（呢個係「記錄現狀」，唔等於「批准」），並喺 review 註明係新發現。**但決策記錄的「延後決定」表有相關項（例如 U1）就唔好補**——照樣留喺延後表等 Dickson，唔好代他收貨。

   以上任何「改 spec」**一律經 change delta → archive**，唔好手改 `specs/`（§4.2）。有相關 active change 就等它 archive 時一次過改。
2. **同級衝突**：同一 capability 有 active change 時，`changes/<name>/specs/` 嘅 delta **贏過** `specs/`。理由：`specs/` 未同步係因為**未 archive**，唔係因為它錯——問「現有行為」睇 `specs/`，做新嘢跟 delta。兩個 active change 互相矛盾 = 唔好自己揀，問 Dickson。
3. **跨級衝突 T2 vs T3**（例如 spec 話可以刪任務，但 AGENTS.md 話 `tasks` 冇 DELETE）= **停手**，唔可以靜靜跟其中一邊，要記錄落 review 再問。
   （**T1 vs T3** 唔屬呢條：文件同現實唔一致就改文件，唔需要問。）

### 2.2 檔案清單

| 路徑 | 級別 | 角色 | 誰把關 | 幾時更新 | 進 git |
|---|---|---|---|---|---|
| `src/**`, `index.html`, `public/**` | **T1** | 前端實際行為 | opencode | 每次實作 | ✅ |
| `tests/**` | **T1** | 行為的可執行證明 | opencode | 每次實作 | ✅ |
| `supabase/migrations/**` | **T1** | **DB schema 唯一權威** | opencode | 每次 schema 變更 | ✅ |
| `openspec/specs/**` | **T2** | **系統現有能力的權威描述** | archive 流程 | 功能新增/移除時 | ✅ |
| `openspec/changes/**` | T2 | 進行中的變更提案 | opencode + Hermes | 每個 Phase | ✅ |
| `openspec/changes/archive/**` | T4 | 已完成變更的存檔 | archive 流程 | 自動 | ✅ |
| `AGENTS.md` | **T3** | 開發規則（agent 入口） | Hermes | 規則或表結構變更時 | ✅ |
| `PROJECT.md`（本檔） | **T3** | 專案地圖 + 文件治理 | Hermes | 新增/移除文件類型時 | ✅ |
| `.github/workflows/deploy.yml` | **T3** | 部署流程 | Hermes | 部署方式變更時 | ✅ |
| `.env.example` | T3 | 環境變數清單（無真值） | Hermes | 新增變數時 | ✅ |
| `Documents/Agent/projects/*Phase N 決策記錄.md` | **T4** | 批准憑證（邊個決定、幾時批） | Hermes | **Phase 完成後凍結** | ❌ repo 外 |
| `Documents/Agent/projects/*開發總覽*.md` | **T5** | 背景與 goals 交代 | Hermes | **只在架構級變更時加註** | ❌ repo 外 |
| `.ai/**` | **T6** | plan / log / prompt | opencode | 隨時 | ❌ gitignored |
| `.opencode/**` | T6 | 工具生成，可再生 | openspec init | 唔維護 | ❌ gitignored |
| `openspec/config.yaml` | T3 | spec 工具設定（schema、project context） | Hermes | 極少改 | ✅ |
| `supabase/config.toml` | T1 | **本地** stack 設定（port、auth、seed）—— 唔係 schema | opencode | 本地環境變更時 | ✅ |
| `package.json` / `package-lock.json` | T1 | 依賴版本 + **驗證命令的定義**（`db:check` 等喺呢度先存在） | opencode | 加/升級依賴時 | ✅ |
| `vite.config.ts` / `tsconfig.json` | T3 | build 設定（`base` 改 repo 名要同步改） | Hermes | 設定變更時 | ✅ |
| `.env` | T1 | **真值**（key、密碼） | Dickson | 換 key 時 | ❌ gitignored |
| `dist/` | T6 | build 產物，可再生 | — | 唔維護 | ❌ gitignored |

> **「誰把關」唔係寫入權限。** 任何 agent 都可以改任何 T3 文件；唔係「Hermes 專屬」。分工係：邊個改，Phase DoD（§5）核對邊個。唯一真例外：`AGENTS.md` 係 protected file，agent（包括主 agent）寫入會被阻止，**要 Dickson 本人改**。
>
> `AGENTS.md` 的「檔案結構」一節只係給 agent 的摘要。兩者唔一致 = 同級衝突：記錄落 §7 問 Dickson，唔好自己改其中一邊（見 §2.1 補充 3）。

### 2.3 唔屬於本專案

| 路徑 | 說明 |
|---|---|
| `Documents/Agent/projects/學校進度表系統-開發記錄.md` | 另一個專案（2026-07），唔關事 |
| `Documents/Agent/projects/學校進度表系統/`（整個目錄） | 同上，另一個專案的資產 |
| `Documents/我的個人助理/**`（vault） | Phase 5 才遷移，現時只讀不改 |

---

## 3. 問題 → 去哪裡找答案（SSOT Map）

> ⚠️ **`openspec/specs/` 有目錄唔等於功能存在**（見 §7 D1）。查 spec 之前，先確認嗰個 capability 有對應程式碼——§3 底有自動偵測命令，`validate --all` **唔會**幫你捉孤兒（實測：guestbook 孤兒 spec 一樣 pass）。

| 我想知… | 睇 | 唔好睇 |
|---|---|---|
| 某個功能**應該**點運作（現有能力） | `openspec/specs/<capability>/spec.md` | 總覽、決策記錄 |
| 某個功能**將會**點運作（進行中） | `openspec/changes/<name>/specs/<cap>/spec.md`（贏過 `specs/`） | — |
| 某個功能**實際**點運作 | `src/**` + `tests/**` | spec（spec 可能滯後） |
| 某張 table 有咩欄位/約束/權限 | `supabase/migrations/**` | AGENTS.md（只列摘要） |
| 為咩揀咗呢個做法 | `Personal Command Center - Phase N 決策記錄.md`（repo 外）＋ `openspec/changes/archive/*/`（有啲決定係喺 change 的 Gate 1 批，唔在決策記錄） | 總覽 |
| 開發規則、禁止事項 | `AGENTS.md` | — |
| 而家做緊咩、仲有咩未做 | `openspec/changes/<name>/tasks.md`（多過一個 active change 就全部睇） | 決策記錄 §2 |
| **由零跑起呢個 repo（新機 / 新人）** | `AGENTS.md` 驗證鏈 + `.env.example`；完整版見 §7 D5 | 總覽 |
| 要咩環境變數、我缺咩 key | `.env.example`（名）／`.env`（值） | §6（只記位置） |
| **已知 bug / 程式債**（唔係文件債） | **一律開 openspec change**（未批都算持久記錄，Gate 1 才係閘）；`.ai/review*.md` 只係起草位，唔好當唯一記錄 | §7（§7 只收文件債） |
| 部署喺邊、點 deploy | §6 本檔 + `.github/workflows/deploy.yml` | — |
| 線上版本對唔對得上 main | `curl -sI <pages url>`（200）＋ `git log -1 --format='%h %ci'` | — |
| 呢個行為有冇 test 保護 | `tests/**`（grep 行為關鍵字） | — |
| 外部服務 URL / 憑證喺邊 | §6 本檔 | — |
| **n8n workflow 邏輯** | **現時無權威**（只存在 localhost n8n，未版控 → D7） | — |
| 專案背景、最初 goals | 總覽（T5） | spec |
| Agent 上次跑咗咩 | `.ai/logs/`（最新檔名 = 時間戳） | — |

**驗證命令**

```bash
npm run typecheck && npm test && npm run build    # T1 是否成立
openspec validate --all                           # T2 是否自洽（孤兒 spec 都會 pass，唔夠）
npm run db:check                                  # migration 與遠端 drift（會連 production，唔好亂跑）
git diff --stat                                   # 有冇未預期改動
```

**孤兒 spec 偵測**（唯一可自動化的部分：捉「spec 引用的表已被 migration 刪除」，2026-11-27 實測正確，今日會捉到 guestbook 一項）

```bash
mig=$(grep -hoiE "(create|drop) table (if (not )?exists )?public\.[a-z_]+" supabase/migrations/*.sql)
alive=$(echo "$mig" | awk '{t=$NF; sub("public.","",t); if (tolower($1$2)=="droptable") s[t]="D"; else s[t]="C"} END{for(t in s) if(s[t]=="C") print t}')
for d in openspec/specs/*/; do for t in $(grep -oE '`[a-z_]{3,}`|public\.[a-z_]+' "$d/spec.md" | tr -d '`' | sed 's/public\.//' | sort -u); do
  echo "$mig" | grep -qE "public\.$t\b" && ! echo "$alive" | grep -qx "$t" && echo "ORPHAN: $(basename $d) -> 表 $t 已刪除"
done; done
```

> 局限（要老實講）：只捉「表被刪但 spec 留低」。捉唔到（a）「表仍在但畫面／功能已移除」；（b）`alter table rename`（舊名會被當成仍存在）；（c）`--skip-specs` 造成嘅 stale spec。以上全部靠 §5「講唔出對應邊個畫面 = 孤兒」補。
>
> 需要 **Git Bash**（`bash`）——PowerShell 直接跑會 fail。長遠應該抽成 `scripts/check-orphan-specs.sh` 並按 §2.2 登記（要動 repo 其他檔，未做）。
>
> 另外：`openspec` 同 `supabase` 兩個 CLI 都係**全域安裝**（`@fission-ai/openspec`、`supabase`），唔在 `package.json`。新機要 `npm i -g @fission-ai/openspec supabase`，否則上面命令跑唔到。

---

## 4. 文件生命週期

### 4.1 每個 Phase 的流程

```
propose (openspec change)  →  Gate 1 批准 + §7 re-triage  →  plan  →  Gate 2 批准
   →  build  →  review  →  verify  →  archive  →  Docs DoD (§5)
```

### 4.2 各文件類型的生命週期

| 文件 | 創建 | 更新 | 歸檔／刪除 |
|---|---|---|---|
| `openspec/changes/<name>/` | Phase 開始 | 決策變更時 | Phase 完成 → `openspec archive` 移入 archive/ |
| `openspec/specs/<cap>/` | archive 時自動合併 | 經 archive（`ADDED`／`MODIFIED`／`REMOVED` delta） | 個別 requirement 移除 → 自動；整個 capability 廢除 → 照寫 delta 會 **abort**，改用 `--skip-specs` ＋ 人手刪目錄（§4.3） |
| `Phase N 決策記錄.md` | Phase 開始 | Phase 進行中 | **Phase 完成後凍結，唔再改**（狀態標記例外，見 §4.3 規則 B） |
| 總覽 | 專案開始 | 架構級變更 | 永不刪除（歷史） |
| `AGENTS.md` | 專案開始 | 表結構/規則變更 | 永不刪除 |
| `PROJECT.md` | 專案開始 | 新增文件類型/外部服務 | 永不刪除 |
| `.ai/**` | 隨時 | 隨時 | 可隨時清空 |

> **「架構級變更」= 改到以下任何一項**：表結構、owner 判定方式、部署拓撲（host／base path／CI）、跨表契約（例如「id 用複合鍵」）。改到 = 總覽要加一行；冇改到 = 唔好碰總覽。D3（`is_owner()` RPC）就係呢個級別。

### 4.3 三條硬規則

**規則 A — 功能移除必須經 openspec change，而且必須帶 `REMOVED` delta。**

舊講法「archive 只會加唔會減」係**觀察錯誤**（呢個 repo 只用過 `ADDED` delta）。openspec 1.6.0 實測（2026-11-27，喺臨時 openspec 專案跑足三次）：

| 情況 | `openspec archive` 實際行為 |
|---|---|
| 移除部分 requirement（capability 仍在） | **自動**扣走，輸出 `- 1 removed` |
| 移除全部 requirement（整個 capability 廢除） | **Abort**：`✗ Spec must have at least one requirement`，唔寫任何檔（先刪目錄都一樣：它會試 `create` 再 abort）。**呢個 abort 就係 tripwire** |
| 有開 change 但**冇寫** delta | **靜靜過**，spec 留低 —— 同 D1 一模一樣，但披住「我有開 change」嘅外衣 |
| 冇開 change 就刪 code + drop table | **冇任何機制**，spec 靜靜留低（D1 就係咁嚟） |

所以：

- **任何功能移除（包括 drop table）都要開 openspec change，而且一定要寫 `REMOVED` delta**——全 capability 廢除都照寫，因為 abort 就係設計上迫你處理嘅訊號。冇 delta 嘅移除 change = 無效 change。
- 全 capability 廢除：`openspec archive <change> --skip-specs` **＋** 手動刪 `openspec/specs/<cap>/`，同一個 commit。順序先 archive（否則它會試 recreate 再 abort）。
- `--skip-specs` 誤用（例如 MODIFIED change）**唔會**產生孤兒，會產生 **stale spec**：主 spec 停喺舊版，上面兩個自動偵測都捉唔到，唯一防線係 §5「逐個目錄講得出對應畫面」。
- **偵測點係 §5 DoD，唔係 archive 本身。** mid-phase 冇任何東西會響，Phase 收工才對賬——所以唔可以靠「我記得我冇刪錯」。
- **整 capability 廢除要獨立一個 change**：唔可以同 `ADDED` delta 混埋。混合 change 嘅 archive 會被「至少一個 requirement」檢查搞到全家 abort，而 `--skip-specs` 又會連新 capability 嘅 merge 一齊跳過——兩邊都行唔通。
- **歷史遺留唔補 delta**：如果 code 同表**早已經**刪咗（D1 就係），唔好假造一個「移除 change」。做法：刪 spec 目錄 + 喺 §7 打 ✅ 並記錄「功能已於某日移除、當時冇開 change」。規則 A 只約束**將來**嘅移除。

**規則 B — 決策記錄係凍結的批准憑證。**
Phase 完成後，**決策內容**唔再改。新決定寫入新 Phase 的記錄。改寫歷史決定 = 偽造批准記錄。

**例外（唔係漏洞，係必要）**：凍結鎖嘅係「決定咗咩、幾時批」，唔鎖「狀態標記有冇寫錯」。如果發現 `⏳` 實際已決定（就係 D2），可以加一條**具名日期修正注記**：

```
> 2026-11-27 修正：P2-02、P2-03、P2-04、P2-07、P2-09、P2-20 已於 Phase 2 決定
> （依據：<填實際出處，例如 openspec change <name> 的 Gate 1 批准／§1 已批准表>），原 ⏳ 標記有誤。
> P2-10／U1 仍然延後，未決定（見 §3 延後決定）。
> 決策內容未改，只更正狀態。— Hermes
```

**反面教材**（就係 D2）：`全部項目已批准，無待議事項。`——冇列 ID、冇依據、而 P2-10／U1 實際仍延後。呢句正好係規則 B 明文禁止嘅「補上從未批准過嘅決定」。寫注記要逐個 ID 對得出批准來源，唔可以用一句概括。

理由：批准記錄嘅價值在於「當時批咗咩」，唔在於「表格有冇打錯剔」。但**唔可以**藉此改寫結論、改日期、或補上從未批准過嘅決定。

**規則 C — 新文件一定要登記。**
新增任何文件／目錄，同一個 commit 內要在 §2.2 加一行（或者明確歸類為 T6 臨時）。冇登記嘅文件 = 下次冇人知它係權威定垃圾，就會出現「兩份文件講唔同嘢」。呢條係 §2.2 唔會腐爛嘅唯一保證。

---

## 5. Phase 完成檢查清單（Docs DoD）

每個 Phase 收工前逐項確認。**每項都要有指令或具體動作，唔接受「望過覺得 OK」。**

**程式 / Schema**

- [ ] `npm run typecheck && npm test && npm run build` 全過
- [ ] 有改 schema 就 `npm run db:check`（會連 production，確認冇 drift 才繼續）
- [ ] `openspec validate --all` 通過

**Spec**

- [ ] `openspec archive <change>` 完成（部分移除用 `REMOVED` delta；整個 capability 廢除見 §4.3）
- [ ] `git status` 見到 `openspec/specs/` 有**預期**嘅改動；用過 `--skip-specs` 就確認目錄真係已刪
- [ ] 跑 §3「孤兒 spec 偵測」命令，輸出**冇** `ORPHAN:` 行
- [ ] `openspec/specs/` 每個目錄，你能講出它對應邊個畫面／API call（講唔出 = 孤兒／stale，即場處理）

**其他文件**

- [ ] `AGENTS.md` 表清單／五條規則與 `migrations/` 一致（改過 schema 必做；AGENTS.md 係 protected file，要人手改）
- [ ] **先**把當期決策記錄所有 `⏳` 變 `✅` 或標「放棄」，**然後**才凍結（次序唔可以反，見規則 B）
- [ ] 總覽：只在架構級變更時加一行（§4.2 定義）
- [ ] `PROJECT.md` §2.2 仍準確（有無新文件類型漏登記，見規則 C）＋ 更新頂部「最後核對」日期
- [ ] `PROJECT.md` §7：新債入表（連「必須清於」），已清的打 ✅
- [ ] `PROJECT.md` §7 全表 re-triage 已做（每項觸發器仍有效／已更新／已清）——唔好帶債開下個 Phase
- [ ] `.env.example` 與 `.env` 變數名一致（Git Bash）：`diff <(grep -oE '^[A-Z_]+' .env.example | sort) <(grep -oE '^[A-Z_]+' .env | sort)`

**交付**

- [ ] git commit + push（`.ai/`、`.env`、`dist/` 冇入 commit）
- [ ] 線上驗證（Git Bash）：`curl -sI https://lammpdagent-collab.github.io/lammpdagent-dashboard/ | head -1` 回 200
- [ ] 線上版本對得到 main（Git Bash）：`git log -1 --format='%h %ci'` 對 GitHub commit 頁

---

## 6. 外部系統登記

> 只記錄**位置與用途**，真值在 `.env`（gitignored）或對應服務的 dashboard。
> **唔准入**：password、token、API key、`service_role` 值。
> **唔算機密、可以寫**：project ref（它本身會 expose 落 client bundle）、n8n credential ID（只對 localhost 有意義）。
> 最後核對：2026-11-27（版本號、URL、ID 都會 rot，超過一個 Phase 冇核對就當可疑）

| 系統 | 位置 | 用途 | 憑證在邊 |
|---|---|---|---|
| Supabase（雲端） | project ref `tmgnqofsyyaigilqkonv`，ap-southeast-1，PG17。**備份：冇**（免費 tier 冇 PITR → D8） | 正式資料庫 | `.env` / `supabase link` |
| Supabase（本地） | docker `supabase_db_lammpdagent-dashboard`，Studio `:54323` | 開發 / 測試 migration | `.env` `SUPABASE_DB_PASSWORD` |
| GitHub repo | `lammpdagent-collab/lammpdagent-dashboard`（**public**，Pages 免費方案要求） | 程式碼 + CI | git credential manager |
| GitHub Pages | https://lammpdagent-collab.github.io/lammpdagent-dashboard/ | 前端部署 | — |
| GitHub Actions | `.github/workflows/deploy.yml`，push main 觸發 | test → build → deploy | repo Variables `VITE_SUPABASE_*` |
| n8n | `http://localhost:5678`，v2.27.4（**workflow JSON 未版控 → D7**） | Phase 3 同步 + Phase 4 cron | n8n 內部 credential store |
| Google Cloud | project `my-agent-498715` | OAuth client | GCP console |
| Google Calendar | work 帳號（**readonly**）／personal 帳號（讀寫） | 事件來源 / 寫入目標 | n8n credential |
| Telegram | Hermes gateway（Phase 4） | 入口 / capture | Hermes config |

**T4／T5 嘅風險要知**：決策記錄同總覽喺 `Documents/Agent/projects/`，**repo 外、冇 git、冇備份**。後果：新機／CI／第二個 agent 查「點解揀呢個做法」會查到一條唔存在嘅路徑；部機壞 = 批准憑證同專案歷史一齊消失。所以 §3 對呢兩份文件只保證「本機」。要補：定期 copy 去 OneDrive／另一部機，或者最小限度寫一份索引（檔名 + 一句結論）放入 repo。

---

## 7. 已知文件債

記錄「知而未修」，避免每次重新發現。

**防墳場機制 = 「必須清於」欄**：每項要有觸發器（邊個 Phase／邊個事件之前一定要清）。**冇觸發器就唔入表**——即係即刻做，或者明確寫「永久接受」。每個 Phase 的 Gate 1 對整張表做一次 re-triage，唔准靜靜留喺度。

| # | 項目 | 影響 | 必須清於 | 狀態 |
|---|---|---|---|---|
| D1 | `openspec/specs/guestbook/spec.md` 孤兒（程式碼、`messages` 表都已冇；`validate --all` 照 pass）。屬「歷史遺留」，唔補 change，見 §4.3 規則 A | 未來 agent 會誤以為功能存在，照 spec 開工 | **即刻** | ✅ 2026-11-27 已刪（`validate --all` → 4/4 pass，冇孤兒） |
| D2 | `Phase 2 決策記錄.md` §2 已有人加註「全部項目已批准，無待議事項」，但**過度聲明**：冇列 ID、冇批准依據，而 P2-10／U1 實際仍屬「延後」 | 下一個 agent 會以為 7 項都有批准憑證；亦違反規則 B | **即刻** | ✅ 2026-11-27 已修：逐個 ID 列依據，P2-10 標明**延後**、P2-20 標明**放棄**，並說明該句由 Hermes 於 01:07 寫入（當時漏列依據） |
| D3 | 總覽 §3.6 未提 `is_owner()` RPC（架構級決定） | 未來前端改動可能重新硬編 email | Phase 3 開始前 | 待補 |
| D4 | 總覽 §7 Phase 2 仍寫「2–3 日」計劃式，冇標記完成 | 低（T5 背景文件） | 下次開總覽時 | 待補一行 |
| D5 | 冇 `README.md`（public repo；「由零跑起」冇完整答案） | 中——public repo 第一眼係死頁；新人／新機卡住 | 下次公開分享／Phase 3 前 | 待寫 |
| D6 | `AGENTS.md` 兩處：① 有一行重複（`public.messages … 已於 2026-11-26 刪除` 出現兩次）；② **缺少指向 §4.3 的指標**——照 AGENTS.md 行事嘅 agent 永遠唔會知「功能移除要開 change」，規則 A 形同虛設 | ① 噪音，令讀者懷疑其他內容；② D1 會重演 | 下次改 AGENTS.md 時（protected file） | ✅ 2026-11-27 已改：重複行已刪；已加 PROJECT.md 指標（開頭）＋「功能移除（含 drop table）」一節（實測行為表） |
| D7 | n8n workflow JSON 未版控（Phase 3 的 T1 事實只存在 localhost docker） | 高——instance 冇咗，同步邏輯就冇咗，而且冇 spec 可以重建 | **Phase 3 開始前** | 待處理 |
| D8 | 雲端 DB 冇任何備份（$0 tier 冇 PITR；n8n 未跑；owner 全部任務＋日曆資料得一份） | 誤刪／Supabase 故障／project 被 suspend = 冇得還 | **Phase 3 開始前**（最少手動 export 一次，存 repo 外） | 待處理 |
| D9 | ~~work calendar credential 仍係 read-write scope~~ **已於 2026-11-27 解決**。改用 `googleOAuth2Api`（scope 欄位可編輯）建新 credential `GCalWorkRO000001`，scope = `https://www.googleapis.com/auth/calendar.readonly`。實測：讀取 7 個日曆成功、寫入（PATCH）回 **HTTP 403 insufficient authentication scopes**。舊 credential `Shzp0fV22UjLVEew` 已標記 DEPRECATED 並清除無效 token | — | ✅ 2026-11-27 | 已解決 |

修完後在「狀態」欄打 ✅ 並保留行（作為歷史）。「永久接受」都可以，但要寫明理由，唔好留空白。

> **D1／D2／D6 已於 2026-11-27 全部清完**（D1 刪 spec、D2 收窄注記、D6 改 AGENTS.md）。§7 嘅「即刻」項現時為零，觸發器機制開始有約束力。

---

## 8. 呢份文件唔應該做嘅事

- ❌ 唔記錄功能細節（去 `openspec/specs/`）
- ❌ 唔記錄 schema（去 `migrations/`）
- ❌ 唔記錄決策理由（去決策記錄）
- ❌ 唔記錄實作進度（去 `tasks.md`）
- ❌ 唔做 onboarding 教學（去 D5；呢份係「地圖」，唔係「導遊」）
- ❌ 唔記錄任何 credential 值

如果發現自己想在這裡寫以上任何一項，代表寫錯地方。

### 呢份文件幾時會失效

唔係永久有效。以下任何一項發生，就要**重寫相關章節**（唔係加註）：

| 事件 | 即刻失效的部分 |
|---|---|
| 第二個**會做實作或批准**嘅 owner／agent 加入（現時實作 = opencode，批准 = Dickson） | §2.1 裁決、§2.2「誰把關」、§4 全流程——成套假設單一 owner + 單一批准人。RLS 硬編一個 email、`is_owner()` 一個人，全部要重寫 |
| 專案完結／停用 | §4 生命週期（要有「最終歸檔」規則）、§6（n8n／docker／`.env` 點處置） |
| 改用 Supabase branch／多環境 | §2.2、§5（`db:check` 唔再夠）、§6 |
| openspec 升級到行為唔同的版本 | §4.3 規則 A（依賴 1.6.0 實測行為）。**升級當下**就要喺 §7 開一項「重跑 §4.3 三個情況」，唔係等出事 |
| Phase 5 vault 遷移完成 | §2.3、§3（vault 由「只讀」變資料源） |
