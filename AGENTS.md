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
npm run db:check    # supabase migration list --remote + db diff --linked
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

## Database 紀律

| 表面 | 可做 | 唔可做 |
|---|---|---|
| 本地 stack（`npm run db:start`） | 任改、亂試、`npm run db:reset` 重建 | — |
| Cloud | 只收已 review 嘅 `supabase/migrations/`（`npm run db:push`） | 唔做實驗場 |
| MCP（唯讀） | `get_advisors`、`generate_typescript_types`、`query_logs` | 唔開寫入 |

**Schema 改動只可經 migration。** 唔准直接喺 dashboard 或 psql 改完再算 —— `db:check` 會揭發 drift。

**RLS 由第一條 migration 寫。** Postgres 冇 policy 會鎖表，但 `GRANT` 咗而冇 RLS = 全開。

## 已知刻意設計

- `test.environment: 'node'` —— 純函數測試，唔需要 jsdom，跑得快
- 只有 `VITE_` 前綴嘅變數會 expose 落 client bundle；`SUPABASE_SERVICE_ROLE_KEY` 冇前綴，所以永遠唔會入 bundle
