# AGENTS.md

項目 conventions —— agent 開工前必讀。

## 驗證鏈（順序，全部要過）

```bash
npm run typecheck   # TypeScript 型別
npm test            # vitest unit test
npm run build       # vite build
```

有改 DB 就再加：

```bash
npm run db:check    # supabase migration list --remote + db diff --remote
```

## 檔案結構

```
src/lib/     純邏輯，唔碰 DOM —— unit test 主要打呢度
src/main.ts  DOM 綁定層
src/types/   由 DB 生成嘅型別（supabase gen types）
tests/       vitest 測試
supabase/    migrations + config（DB 嘅唯一真相來源）
openspec/    spec 系統（主 spec + change 歷史）
```

新功能嘅邏輯一律放 `src/lib/`，`main.ts` 只做接線。

## 唔入 git 嘅嘢

| 路徑 | 原因 | 重建方法 |
|---|---|---|
| `.env` | 真實 key（`service_role` 繞過 RLS） | 對照 `.env.example` |
| `.ai/` | agent 工作目錄（plan / patch / review 日誌） | 自動建立 |
| `.opencode/` | `openspec init --tools opencode` 生成 | `openspec init --tools opencode` |
| `node_modules/`、`dist/` | 建置產物 | `npm i` / `npm run build` |
| `supabase/.temp/`、`supabase/.branches/` | CLI 暫存 | 自動重建 |

## Deployment (GitHub Pages)

Repo 係 **public**（Pages free plan 要求），push `main` 自動部署。

| 項目 | 值 |
|---|---|
| 網址 | https://lammpdagent-collab.github.io/lammpdagent-dashboard/ |
| Base path | `/lammpdagent-dashboard/` — `vite.config.ts` 的 `base`，改 repo 名要同步改 |
| Build 環境變數 | GitHub Actions **Variables**（非 Secrets）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` |
| Pages source | GitHub Actions（`build_type=workflow`） |

`deploy.yml` 流程：`configure-pages` → `npm ci` → `npm test` → 檢查 Variables 非空 → 寫 `.env` → `npm run build` → 上傳 artifact → `deploy-pages`。

**轉 public 之前**必須掃 git history 冇 secret：`git log --all -- .env` 要空，並掃 `sb_secret_` 字串。`SUPABASE_SERVICE_ROLE_KEY` 永遠唔可以出現喺 CI 或 client bundle。

## Database 紀律

| 表面 | 可做 | 唔可做 |
|---|---|---|
| 本地 stack（`npm run db:start`） | 任改、亂試、`npm run db:reset` 重建 | — |
| Cloud | 只收已 review 嘅 `supabase/migrations/`（`npm run db:push`） | 唔做實驗場 |
| MCP（唯讀） | `get_advisors`、`generate_typescript_types`、`query_logs` | 唔開寫入 |

**Schema 改動只可經 migration。** 唔准直接喺 dashboard 或 psql 改完再算 —— `db:check` 會揭發 drift。

**RLS 由第一條 migration 寫。** Postgres 冇 policy 會鎖表，但 `GRANT` 咗而冇 RLS = 全開。

## 資料表（2026-11-27 起）

| 表 | 用途 | owner 權限 | 寫入者 |
|---|---|---|---|
| `tasks` | 任務（4 級 priority、`todo`/`done`/`park`、pinned、tags、markdown notes） | select / insert / update（**冇 DELETE**） | 前端、Hermes、service_role |
| `events` | 日曆事件鏡像（複合 id `{account}_{google_event_id}`） | **只讀** | n8n（service_role） |
| `system_meta` | 每個同步來源一行的狀態（`calendar_sync:personal` / `:work`） | **只讀** | n8n（service_role） |
| `tags` | tag 目錄（`name` PK），容許未被任何任務使用的 tag 存在 | select / insert（**只 `name` 欄**）/ delete | 前端、Hermes |
| `cycle_days` | 校曆循環日對照（`date` PK、`day_label` A–F） | **只讀** | n8n（service_role） |

五條唔可以違反的規則：

- **`tasks` 冇 DELETE 權限。** 刪除＝`deleted_at` 設時間，前端只可以 UPDATE。真刪除只可以經 service_role。
- **`completed_at` 由 trigger 獨佔。** 唔在 client 的 grant 清單內；`status='done'` 時自動填、離開 `done` 時自動清。需要補記歷史完成日期時用 service_role。
- **`events` 唔做過期清理。** 唔會有 `DELETE WHERE last_synced_at < ...`。Google 上被取消的事件用 `cancelled_at` 標記，不刪除。
- **`cycle_days` 前端只讀。** `updated_at` 由 `BEFORE UPDATE` trigger 獨佔；寫入只經 n8n（service_role）。
- **`anon` 零權限。** 五張表都 `revoke all` 之後只 grant 俾 `authenticated`。anon 打 REST 會回 401，唔係 0 行。

### owner 身份寫在兩處，改要一齊改

`owner email` 硬編在：① Phase 1 的五條 RLS policy；② `public.is_owner()` function。兩處必須一致 —— 前端不硬編 email，只經 RPC `is_owner()` 判斷。

`public.messages`（guestbook 測試表）已於 2026-11-26 刪除。

`public.messages`（guestbook 測試表）已於 2026-11-26 刪除。

## 已知刻意設計

- `test.environment: 'node'` —— 純函數測試，唔需要 jsdom，跑得快
- 只有 `VITE_` 前綴嘅變數會 expose 落 client bundle；`SUPABASE_SERVICE_ROLE_KEY` 冇前綴，所以永遠唔會入 bundle
