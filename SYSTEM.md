# SYSTEM.md — 全系統地圖（跨 repo + runtime）

> `PROJECT.md` 答「repo 內的 X 去邊度搵」。
> **呢份文件答「repo 以外的 X 去邊度搵，同埋改一樣嘢會唔會整爛另一樣」。**
>
> 讀者：未來嘅 agent。Dickson 只需記 §5 的四類同步點 + §11 的強制機制。
>
> **路徑基準**：L4 的路徑一律相對 `%LOCALAPPDATA%\hermes\profiles\`（Windows）。
> ⚠️ 唔好用 `$HERMES_HOME` —— 它本身已經指住一個 profile 目錄（例如 `...\profiles\coding`），
> 展開 `$HERMES_HOME/profiles/personal-assistant` 會變成唔存在的雙重路徑。
> 亦唔好同 `~/.hermes`（只有 orchestrator）或 `AppData\Roaming\hermes`（Electron app data）混淆。
>
> 級別：**T3**（規則）。裁決一律返 `PROJECT.md §2.1`（本檔唔另立一套，見 §9）。
> 最後核對：**2026-11-28**（下次核對：改 spec 前，或每月一次，見 §7）

---

## 1. 為什麼需要這份文件（真實失敗案例）

**2026-11-28 事故**：`skills/daily-briefing/SKILL.md` 第 33 行教 agent「首選讀 vault 的 🔗 標記」，但同一份文件第 78 行寫「⚠️ briefing 唔再讀 vault」。同時 `openspec/specs/daily-briefing/spec.md` 明寫「相關性 SHALL 由查詢層以 keyword 判定」。

**三個地方，三種講法。** Agent 行為不確定。

根因有兩個，本檔只醫到第一個：

| # | 根因 | 本檔有冇醫 |
|---|---|---|
| 1 | `PROJECT.md` 只登記 repo 內的檔案，`SKILL.md` / `cron/jobs.json` / `SOUL.md`（repo 外）無任何登記 | ✅ §3、§4 |
| 2 | **冇強制機制**確保改 spec 時同步改 runtime | ⚠️ §11 提供掛鈎點，但**唔會自動響**——靠 `tasks.md` 逐項打勾 |

**呢份文件唔係萬能藥。** 它令 drift 看得見，唔令 drift 唔可能發生。

> ⚠️ **現狀（2026-11-28）**：`skills/daily-briefing/SKILL.md` 第 29–39 行的 Wikilink Detection 段落
> **仍然未修**，同同一份文件第 76–78 行「briefing 唔再讀 vault」仍然矛盾。
> 本檔記錄了這個 drift，但未清場。修法見 §13。
> 未來 agent 睇完 §4 去 check SKILL.md，會即刻撞正這個已知 contradiction —— 這是預期，不是新發現。

---

## 2. 系統邊界（7 層）

```
┌─ L0 資料源（外部）──────────────────────────────────────┐
│  Google Calendar：work（readonly）+ personal（讀寫）      │
│  GCP project: my-agent-498715（OAuth client）             │
│  Gmail：學校 calendar update email                        │
└───────────────────────────────────────────────────────────┘
       ↓ n8n 定時拉          ↑ Hermes cron 寫入（school-sync）
       │（90d 每小時/30d 半小時）  │
       │  學校 email 的真實流向：Gmail → Hermes cron
       │  0686309c2d85 / 89aa9f1296f2（google-workspace skill）
       │  → 寫 Google Calendar → **n8n 才拉入 Supabase**
       │  ⚠️ n8n 的 45 個 node 冇任何 email/IMAP 節點（2026-11-28 實測）
┌─ L1 n8n（host，localhost:5678）──────────────────────────┐
│  live workflow: **1 個**（calSyncWf0000001 'calendar-sync'│
│                          45 nodes，active）               │
│  儲存位置：`~/.n8n/database.sqlite`                       │
│  ⚠️ `~/.n8n/workflows` 目錄**唔存在**（唔好照官方文件寫）  │
│  權威：`n8n/workflows/calendar-sync.json`（repo 快照）    │
│        ✅ 2026-11-28 核實與 live nodes hash 完全相同       │
│  改動流程：n8n UI 改 → **即刻 export 落 repo**             │
└───────────────────────────────────────────────────────────┘
              ↓ upsert
┌─ L2 Supabase（雲端 Postgres，ap-southeast-1 PG17）───────┐
│  project ref: tmgnqofsyyaigilqkonv                        │
│  events / tasks / cycle_days / tags / system_meta         │
└───────────────────────────────────────────────────────────┘
        ↓ 讀                    ↓ 讀
┌─ L3 Repo（git 版控）─────────────────────────────────────┐
│  lammpdagent-dashboard                                    │
│  ├─ src/ + index.html         前端（dashboard）           │
│  ├─ briefing/fetch.ts + relevance.ts   briefing 查詢層    │
│  ├─ tests/                    可執行證明                  │
│  ├─ supabase/migrations/      DB schema 唯一權威          │
│  ├─ openspec/specs/           行為權威（T2）              │
│  ├─ n8n/workflows/            L1 快照                     │
│  └─ AGENTS.md / PROJECT.md / SYSTEM.md   規則（T3）       │
└───────────────────────────────────────────────────────────┘
              ↓ GitHub Actions → GitHub Pages
┌─ L4 Hermes runtime（repo 外，%LOCALAPPDATA%\hermes\profiles\）┐
│  personal-assistant/   ← briefing + capture 的實際行為     │
│  （根目錄：%LOCALAPPDATA%\hermes\profiles\）               │
│  ├─ SOUL.md            MODE 1/2/3、回覆格式               │
│  ├─ skills/daily-briefing/SKILL.md                        │
│  ├─ skills/note-taking/{obsidian,school-calendar-sync}/   │
│  ├─ skills/productivity/google-workspace/                 │
│  ├─ cron/jobs.json     7 個 job                           │
│  ├─ cron/prompts/      外部 prompt 檔                     │
│  ├─ .skills_prompt_snapshot.json   skills 描述快取        │
│  └─ config.yaml        model / toolsets                   │
│  coding/               ← orchestration profile            │
│  （default profile 唔參與本專案）                         │
└───────────────────────────────────────────────────────────┘
              ↓ capture 寫入（保持運作，唔再作為 source）
┌─ L5 Vault（Obsidian，標本）──────────────────────────────┐
│  任務.md / 事件.md / 收件箱.md / 任務/ / 事件/            │
│  角色：capture 仍寫入；**briefing 唔讀**                   │
└───────────────────────────────────────────────────────────┘

┌─ L6 決策記錄（repo 外，無 git）──────────────────────────┐
│  Documents/Agent/projects/*決策記錄.md   T4（凍結）       │
│  Documents/Agent/projects/*開發總覽*.md  T5（背景）       │
└───────────────────────────────────────────────────────────┘
```

---

## 3. 資產登記補充（L1 + L4）

> `PROJECT.md §2.2` 登記 L3（repo）。以下係 L1 + L4。
> **級別沿用 `PROJECT.md §2.1` 的 T1–T6，本檔唔另立。**
> 判別原則：**agent 實際會照住執行的檔案 = T1（事實）**；spec 講應該點做 = T2。

### 3.1 L1 n8n

| 位置 | 級別 | 角色 | 幾時更新 |
|---|---|---|---|
| `~/.n8n/database.sqlite`（live）| T1 | 實際運行中的 workflow | n8n UI 改動時 |
| `n8n/workflows/calendar-sync.json` | T1（快照）| L1 的可版控副本，已核實同步 | UI 改動後即刻 export |

### 3.2 L4 Hermes runtime

| 路徑（相對 `%LOCALAPPDATA%\hermes\profiles\personal-assistant\`）| 級別 | 角色 | 幾時更新 |
|---|---|---|---|
| `SOUL.md` | **T1** | MODE 1/2/3、capture 流程、回覆格式 | 行為變更時 |
| `skills/daily-briefing/SKILL.md` | **T1** | briefing 三步流程、輸出模板 | briefing 行為變更時 |
| `skills/note-taking/school-calendar-sync/SKILL.md` | T1 | 學校 email → calendar 同步 | 同步邏輯變更時 |
| `skills/note-taking/obsidian/SKILL.md` | T1 | vault 寫入格式 | vault 格式變更時 |
| `skills/productivity/google-workspace/SKILL.md` | T1 | Gmail / Calendar API 操作 | 極少改 |
| `cron/jobs.json` | **T1** | 7 個 job 的 prompt + skills 陣列 | job 邏輯變更時 |
| `cron/prompts/event-cleanup.md` | T1 | job `e61e0ed6f496` 的外部 prompt | 清理邏輯變更時 |
| `scripts/school_cal_monitor.py` | T1 | job `0686309c2d85` / `89aa9f1296f2` 的 `monitor_script` | 監控邏輯變更時 |
| `.skills_prompt_snapshot.json` | T6 快取 | skills 描述快照（可作 drift 偵測基線）| 自動 |
| `config.yaml` | T1 | model / toolsets / 權限 | 極少改 |
| `state.db` / `cron/deliveries.db` / `cron/executions.db` | T6 | session + cron 歷史 | 自動 |
| `../coding/SOUL.md`（即 `profiles\coding\SOUL.md`，**唔在 personal-assistant 內**）| T3 | orchestration 規則 | 流程變更時 |

**唔准 copy 入 git**（含敏感內容）：profile 內的 `.env`、`google_token.json`、**`google_client_secret.json`**、`auth.json`、`state.db`。

---

## 4. Spec ↔ Runtime 對應表（核心）

> **改 spec 之前，睇右欄；改 runtime 之前，睇左欄。**

| Spec（L3）| Runtime 實作（L4 / L3 code）| 其他受影響 |
|---|---|---|
| `specs/daily-briefing/spec.md`（9 req）| `skills/daily-briefing/SKILL.md` 全部<br>`briefing/fetch.ts`（時間窗、去重、sync）<br>**`briefing/relevance.ts`**（keyword 分類 = 2026-11-28 事故主角）| cron `43e12b7b639e`（0700）+ `53e9cb790c3d`（1300）的 prompt 與 skills 陣列；`SOUL.md` MODE 2 |
| `specs/capture-dual-write/spec.md`（5 req）| `SOUL.md` Step 1 / 2 / 2a / 2b / 2c / 2d / 3 / 3b / 4 + 運作規則 | `skills/note-taking/obsidian`（vault 寫入）|
| `specs/ad-hoc-query/spec.md`（4 req）| `SOUL.md` MODE 3 + `skills/daily-briefing/SKILL.md`（`manual（query mode）`）| `briefing/fetch.ts --mode query` |
| `specs/task-management/spec.md`（7 req）| `src/lib/taskQuery.ts` + `src/main.ts` | dashboard UI |
| `specs/calendar-sync/spec.md`（8 req）| `n8n/workflows/calendar-sync.json`（45 nodes）| `skills/note-taking/school-calendar-sync`；cron `0686309c2d85` / `89aa9f1296f2` |
| `specs/calendar-events/spec.md`（6 req）| `src/lib/eventQuery.ts` + `src/main.ts` | dashboard 日曆畫面 |
| `specs/sync-status/spec.md`（5 req）| `src/lib/syncStatus.ts` + `briefing/fetch.ts`（`sync` 欄位）| dashboard 同步狀態；briefing footer |

**對應表冇列出嘅 spec** = 本表過時 → 補一行（§9 裁決）。

---

## 5. 改一樣嘢的四類影響（Dickson 只需記這個）

### 同步點 ①：改 **behavior** → 必經 spec

```
改 behavior（例如「加新 keyword」「改時間窗」「改回覆格式」）
  → 開 openspec change（spec delta）
  → Gate 1 批准
  → 改 code（opencode）
  → **同步改 L4 runtime**（§11 強制機制）
  → archive
```

### 同步點 ②：改 **實作細節**（唔改 behavior）→ 唔需要 spec

```
改 SKILL.md 措辭、改 cron skills 陣列、改 prompt 寫法
  → 唔需要 openspec change
  → 但要備份 + Dickson 批准
  → **檢查：改完之後仍符合 spec 嗎？**
```

**⚠️ 升級規則（硬線）**：任何 `SKILL.md` / `SOUL.md` / `cron prompt` 修改，**只要掂到任何 spec 的 `SHALL` 語句**，自動升級為 ①。

理由：prompt 類資產的「措辭」就是行為載體（LLM 照字面執行）。2026-11-28 事故正是「一句 SKILL.md 文字違反 spec 的 SHALL」。

### 同步點 ③：改 **schema** → 只可經 migration

```
改 table / 欄位 / constraint
  → 新 migration 檔（唔可以 psql 手改）
  → npm run db:check 確認無 drift
  → 同步改 AGENTS.md 表清單（protected file，Dickson 手動）
```

### 同步點 ④：改 **排程時間**（特例：六處一組）

`0700 → 0730` 這種改動，**朝早窗** spec 冇 pin（「當日 00:00 起」），所以唔屬 ①。但實際要改**六處**：

1. `cron/jobs.json` 的 `schedule.expr`
2. `cron/jobs.json` 的 job **`name`**（`每日早上簡報 (0700)` 時間硬寫喺名度）
3. `skills/daily-briefing/SKILL.md` 的 `Timing:` 行
4. `SOUL.md` MODE 2 的對應描述（「固定時間 0700 + 1300」+ 分節）
5. **`SYSTEM.md §4` 自己**（`43e12b7b639e（0700）` 寫在對應表）—— 文件自己都係同步點
6. `PROJECT.md` §3 如有提及（現時冇，但改下午就可能要）

**⚠️ 下午例外**：daily-briefing spec **明文 pin 咗** `start_time >= 當日 13:00 HKT` 的下午窗（含多個 Scenario）。
改 `1300 → 1400` **掂到 SHALL** → 按 §5② 升級規則，**行 ① 唔係 ④**。

漏一處 = drift。

---

## 6. 影響矩陣（改 X → 邊啲要一齊檢查）

| 改這個 | 必須一齊檢查 | 漏咗會點 |
|---|---|---|
| `openspec/specs/*/spec.md` | §4 對應表的 runtime 實作 | SKILL.md 教舊做法，agent 行為不確定 |
| `skills/daily-briefing/SKILL.md` | spec 的 9 個 requirement 是否仍符合 | 實作違反 spec（2026-11-28 事故）|
| **`briefing/relevance.ts`** | `specs/daily-briefing` 的「相關性過濾」req + SKILL.md 相關度分類 | keyword 清單三方不一致 |
| `cron/jobs.json` 任何 job 的 `skills` 陣列 | 該 job 的 prompt 有冇用到被移除的 skill | job 跑錯或 crash |
| `cron/jobs.json` 任何 job 的 `prompt` | 對應 SKILL.md 的步驟是否仍一致 | prompt 叫 agent 做 A，SKILL 教 B |
| **`cron/jobs.json` 任何 job 的 `schedule`** | **job name + SKILL.md Timing 行 + SOUL.md MODE 2 + SYSTEM.md §4**（§5 ④ 六處）| 六處時間唔一致 |
| `SOUL.md` 任何 MODE | `specs/capture-dual-write` + `specs/ad-hoc-query` | capture 行為偏離 spec |
| `briefing/fetch.ts` 輸出欄位 | spec「JSON 輸出契約」req + SKILL.md 模板 | briefing 顯示 undefined |
| `supabase/migrations/*.sql` | `AGENTS.md` 表清單（需 Dickson 手動）| AGENTS.md 說 A，DB 是 B |
| `n8n` UI 內的 workflow | **export 落 `n8n/workflows/*.json`** + 核對 nodes hash | instance 掉了 = 邏輯消失 |
| `src/lib/*.ts` | `tests/*.test.ts` + 對應 spec | typecheck 過但行為錯 |
| **`src/main.ts`** | `tests/` + dashboard 三個 spec（task / event / sync-status）| UI 行為無 spec 保護 |

---

## 7. 檢查清單

### 改 spec 時（Phase 收工前）

- [ ] 對照 §4，逐個 runtime 實作檔確認仍符合新 spec
- [ ] **§11 的 L4 同步 task 已在 `tasks.md` 打勾**
- [ ] 跑 `npm run typecheck && npm test && npm run build`
- [ ] 跑 `npm run docs:check`，任何 FAIL 都要修完才收工
- [ ] `openspec validate --all`
- [ ] 跑 `PROJECT.md §5` 的 Docs DoD 全套
- [ ] 改過 L4 的話：備份到 `.ai/backup-YYYYMMDD/` + **Dickson 手動觸發一次**驗證（repo 側 agent 觸發唔到 Hermes cron）

### 改 L4 runtime 時（唔經 spec）

- [ ] 確認**唔掂到任何 SHALL**（掂到 → 升級 §5 ①）
- [ ] 備份原檔到 `.ai/backup-YYYYMMDD/`
- [ ] 改完對照 spec：每一條 requirement 仍成立嗎？
- [ ] 驗證：Dickson 手動觸發相關 cron，或 send 一次 capture

### 每月 / 每個 Phase 開始時

> **唔做會點**：cron ID、node 數、路徑會靜靜 rot。本版第一稿就係「路徑第一天就錯」的實證。
> 掛在「開新 openspec change 時」順手做——有觸發器才唔會死。

- [ ] §4 對應表逐行核對：spec 檔名存在？runtime 路徑存在？
- [ ] n8n live vs `n8n/workflows/*.json` 是否一致（**nodes + connections 兩樣都要**）：
  ```bash
  # 本機冇 sqlite3 CLI，用 Python 的 sqlite3 module
  python -c "
import os, sqlite3, json, hashlib
db = sqlite3.connect(os.path.expanduser('~/.n8n/database.sqlite'))
row = db.execute('select nodes, connections from workflow_entity').fetchone()
snap = json.load(open(r'n8n/workflows/calendar-sync.json', encoding='utf-8'))
for label, live, s in [('nodes', json.loads(row[0]) if isinstance(row[0], str) else row[0], snap['nodes']),
                       ('conn',  json.loads(row[1]) if isinstance(row[1], str) else row[1], snap['connections'])]:
    h = lambda x: hashlib.sha256(json.dumps(x, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()[:16]
    print(f'{label}: live={h(live)} snap={h(s)} {"OK" if h(live)==h(s) else "DRIFT"}')
"
  ```
  > 只 hash `nodes` 有洞：UI 改線唔改 node，hash 照過。所以要連 `connections`。
- [ ] 更新本檔頂部「最後核對」日期

---

## 8. 呢份文件唔應該做嘅事

- ❌ 重複 `PROJECT.md §2.2` 的 L3 檔案清單 → 去 `PROJECT.md`
- ❌ 記錄 spec 的 requirement 內容 → 去 `openspec/specs/`
- ❌ 記錄 runtime 檔案的功能細節 → 去該檔案本身
- ❌ 記錄 credential 值 → 去 `.env`
- ❌ 寫死本機絕對路徑（repo 是 public）→ 用 `%LOCALAPPDATA%\hermes\profiles\<profile>` 形式
  > ⚠️ **唔好用 `$HERMES_HOME`** —— 它已指住單一 profile 目錄（見頂部警告）。n8n 的路徑用 `~/.n8n/`（Python 的 `os.path.expanduser`、Node 的 `os.homedir()`），唔好寫死使用者名。

> **例外（load-bearing，唔好刪）**：§2 L5 的「briefing 唔讀 vault」屬**邊界定義**，唔係功能細節。刪走佢 = 重新製造 2026-11-28 事故。

---

## 9. 衝突裁決

**一律返 `PROJECT.md §2.1`。本檔唔另立裁決規則。**

| 情況 | 去邊 |
|---|---|
| spec（T2）vs runtime（T1）不一致 | `PROJECT.md §2.1` 補充 1 → **停手問 Dickson** |
| 本檔（T3）vs `PROJECT.md`（T3）不一致 | 現實贏；兩份都改 |
| 本檔 vs `AGENTS.md`（T3）| `AGENTS.md` 贏（agent 入口）；衝突記錄在 `PROJECT.md §7` |
| §4 說 spec A 對應 runtime B，但實際已改名 | 改本檔（T3，現實贏）|

---

## 10. 呢份文件幾時會失效

| 事件 | 失效部分 |
|---|---|
| 新增第 4 個 Hermes profile 參與本專案 | §2 L4 圖、§3.2 |
| briefing 改由 n8n 而非 Hermes cron 觸發 | §4 daily-briefing 行、§2 L4 |
| vault 完全退役（唔再 capture 寫入）| §2 L5、`capture-dual-write` 對應行 |
| 引入第二部機／第二個 owner | §2 全部（路徑假設單機）|
| L4 檔案搬入 repo 版控 | §3.2、§4 全部路徑 |
| n8n 加第二個 workflow | §2 L1、§3.1 |

---

## 11. L4 同步的強制機制（根因 2 的答案）

**問題**：`openspec archive` 技術上碰唔到 L4，而「同步改 L4」只活在散文同檢查清單 → 半年後必重演。

**機制**：接入現有的 `tasks.md` 逐項打勾流程。

每個**改到 behavior** 的 openspec change，`tasks.md` 必須有這一段：

```markdown
## N. L4 Runtime 同步（改到 behavior 才需要）

- [ ] N.1 逐個對照 `SYSTEM.md §4` 對應表，確認每個 runtime 實作檔仍符合新 spec
- [ ] N.2 有改 SKILL.md → 備份 + 修改
- [ ] N.3 有改 cron prompt / skills 陣列 → 備份 + 修改
- [ ] N.4 有改 SOUL.md MODE → 備份 + 修改
- [ ] N.5 Dickson 手動觸發一次相關 cron 驗證
```

**唔加這段 = change 唔完整**（Gate 2 時 Hermes 應該退返）。

**實測（openspec 1.6.0 source）**：`core/archive.js` 在 archive 前數 checkbox，
`incompleteTasks > 0` → `throw ArchiveBlockedError('archive_tasks_incomplete')`。
task 計數係**全檔行式**（`/^[-*]\s+\[[\sx]\]/i`），加 `##` 段落**唔會搞爛 CLI**。

所以機制比預期硬：**N.1–N.5 未打勾，`openspec archive` 真的會死**，唔止 Gate 2 退返。

⚠️ **不要養成 `--yes` 過關習慣** —— `--yes` 會連真嘅未完成 code task 檢查一齊跳過，
令 L4 段變成「被迫打假勾」的誘因。

**輔助偵測（兩層）**：

1. **`.skills_prompt_snapshot.json`**（47 KB）記錄所有 skill 的描述與 mtime。改完 skill 之後會自動 regenerate —— 可比較「snapshot 有冇更新」作為「skill 真係改過」的旁證。
2. **`npm run docs:check`**（`scripts/docs-check.ts`）—— 機械檢查 `SYSTEM.md §4` 對應表的每一行是否在現實中仍成立：spec 檔存在、runtime 路徑存在、`cron/jobs.json` 的 skills 目錄存在、n8n live vs 快照 hash 一致。**任何一項 FAIL 就 exit 1**。

**分工**：`tasks.md` 管「有冇做」，`docs:check` 管「做完之後現實係咪仍然一致」。兩者互補，唔可以互相代替 —— 前者靠打勾（可能打假勾），後者靠磁碟事實（唔可以講大話）。

---

## 12. 相關文件

| 文件 | 關係 |
|---|---|
| `PROJECT.md` | L3（repo）的地圖。本檔的 L3 部分唔重複它 |
| `AGENTS.md` | agent 入口摘要（protected file）。本檔是它的 L4 補充 |
| `.ai/review-prompt-system-md-r1/r2/r3.md` | 本檔的三輪獨立 review 記錄（glm-5.3-flash）|

---

## 13. 已知 drift（未清場）

> §1 講的 2026-11-28 事故**仍然存在**。本節記錄「知而未修」，同 `PROJECT.md §7` 同級。
> 防墳場機制：每項要有觸發器，冇觸發器就即刻做。

| # | 項目 | 影響 | 必須清於 |
|---|---|---|---|
| S1 | `skills/daily-briefing/SKILL.md` 第 29–39 行（Wikilink Detection）同第 76–78 行（唔讀 vault）矛盾；同 `specs/daily-briefing` 的 keyword 分類不一致 | **live drift**：agent 讀 briefing skill 會收到矛盾指示 | **下一個 briefing 相關 change 開始前** |
| S2 | `briefing/SOUL.patch.md` 已套用但仍在 repo（含 n8n credential ID，唔算機密） | 噪音；未來 agent 可能以為未套用 | 下次改 repo 時 |
| S3 | ~~`PROJECT.md §2.2` 未登記 `briefing/**`、`n8n/**`、`SYSTEM.md`~~ | — | ✅ 2026-11-28 已補三行 |
| S4 | ~~`PROJECT.md` §6/D7/§3 仍寫 n8n「現時無權威」~~ | — | ✅ 2026-11-28 三處已改（§3 SSOT、§6 表、D7）|

**S1 的修法**：把 SKILL.md 第 29–39 行改為「相關度由 `fetch.ts` / `relevance.ts` 分類，直接消費 JSON 的 `relevance` 欄位」，刪走 vault 🔗 首選。同屬「改 L4 但掂到 SHALL」→ 按 §5② 升級規則**應該開 openspec change**，或者由 Dickson 明確批准為「純措辭修正」。
