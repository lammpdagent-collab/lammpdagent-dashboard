# lammpdagent-dashboard

個人 Command Center：Google Calendar → Supabase → 靜態前端（GitHub Pages）+ Telegram 入口。
**$0/月**營運（免費方案）。

Live: https://lammpdagent-collab.github.io/lammpdagent-dashboard/

---

## Repo 結構：三種東西，唔好混淆

| 路徑 | 屬於 | 會唔會部署 |
|---|---|---|
| `src/`、`index.html`、`public/` | **產品**（前端）| ✅ 會 build 入 `dist/` |
| `briefing/`、`n8n/workflows/` | **產品後端**（briefing 查詢層、n8n 快照）| ❌ 唔部署，但屬功能 |
| `supabase/migrations/` | **DB schema 唯一權威** | ❌ 唔部署 |
| `openspec/specs/` | **行為權威**（產品能力描述）| ❌ 唔部署 |
| `scripts/`、`tests/` | **開發工具** | ❌ 唔部署 |
| `*.md`（`AGENTS.md` / `PROJECT.md` / `SYSTEM.md`）| **文件與規則** | ❌ 唔部署 |

> `openspec/specs/` 只收**產品功能**。開發工具（如 `scripts/docs-check.ts`）的行為契約由 `tests/` 釘住，唔會入 spec。

---

## 文件導覽

| 想知 | 睇邊份 |
|---|---|
| 有咩檔案、權威級別（T1–T6）、衝突點裁決 | `PROJECT.md` |
| 全系統地圖：repo 外的 runtime、spec↔runtime 對應表、改嘢的影響 | `SYSTEM.md` |
| 開發硬規則（protected，衝突時贏）| `AGENTS.md` |
| 產品行為的權威描述 | `openspec/specs/` |

---

## 開發命令

```bash
npm run dev          # vite dev server
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # typecheck + vite build

npm run docs:check   # 驗證 SYSTEM.md §4 的 spec↔runtime 對應關係
npm run docs:check -- --no-l4   # CI 用：跳過 Hermes profile 檢查
```

`docs:check` 讀 `SYSTEM.md §4` 作為唯一資料源，驗證：spec 檔存在、runtime 路徑存在、`cron/jobs.json` 的 skills 目錄存在、n8n live vs 快照 hash 一致。**任何一項不一致就 exit 1。**

### DB

```bash
npm run db:push      # 套用 migration 到遠端
npm run db:check     # 確認冇 drift
npm run db:types     # 重新生成 src/types/db.ts
```

**Schema 改動只可經 migration。** 直接喺 dashboard 或 psql 改完再算，`db:check` 會揭發 drift。

---

## 環境變數

`.env.example` 有完整清單。真值唔准入 git。

`SUPABASE_SERVICE_ROLE_KEY` 永遠唔可以出現喺 CI 或 client bundle。
