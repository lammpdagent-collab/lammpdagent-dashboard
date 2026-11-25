## 1. Migration 骨架

- [ ] 1.1 建立 `supabase/migrations/<timestamp>_create_command_center_tables.sql`
- [ ] 1.2 在檔案頂部寫註解，說明三段（建表 / 權限 / 清理）與 `DROP messages` 的破壞性
- [ ] 1.3 確認 migration 在單一 transaction 內（不加 `-- no transaction`）

## 2. 建立三張表

- [ ] 2.1 `CREATE TABLE public.tasks`：全部欄位 + 四組 CHECK（title 非空白、priority、category、status）+ DEFAULT 值
- [ ] 2.2 `CREATE TABLE public.events`：全部欄位 + 兩組 CHECK（account_key、relevance）+ DEFAULT 值
- [ ] 2.3 `CREATE TABLE public.system_meta`：`key` / `last_run_at` / `status` / `detail` / `message` + status CHECK
- [ ] 2.4 確認 `tasks.id` 預設 `gen_random_uuid()`，`events.id` 為 TEXT 無預設

## 3. 索引

- [ ] 3.1 `CREATE INDEX` on `tasks (status, due_date) WHERE status <> 'done'`
- [ ] 3.2 `CREATE UNIQUE INDEX` on `tasks (source_ref) WHERE source_ref IS NOT NULL`
- [ ] 3.3 `CREATE INDEX` on `events (start_time)`
- [ ] 3.4 `CREATE INDEX` on `events (account_key, last_synced_at)`

## 4. Trigger 與複寫設定

- [ ] 4.1 建立 `public.touch_updated_at()` function（`NEW.updated_at = now()`）
- [ ] 4.2 `CREATE TRIGGER` BEFORE UPDATE on `tasks`
- [ ] 4.3 `ALTER TABLE public.events REPLICA IDENTITY FULL`

## 5. RLS 與權限

- [ ] 5.1 三張表 `ENABLE ROW LEVEL SECURITY`
- [ ] 5.2 `tasks`：select / insert / update 三條 policy，條件為 `auth.jwt() ->> 'email' = '<owner email>'`（不建立 DELETE policy）
- [ ] 5.3 `events`：只有 select policy
- [ ] 5.4 `system_meta`：只有 select policy
- [ ] 5.5 三張表 `REVOKE ALL` from `anon`, `authenticated`；然後 **只** 對 `authenticated` 精確 GRANT（tasks: select / insert(欄級) / update(欄級)；events: select；system_meta: select）
- [ ] 5.5b 確認 `anon` 冇任何 grant（revoke 之後不再授權）
- [ ] 5.6 確認沒有殘留 Supabase 預設的 ALL 授權

## 6. Realtime

- [ ] 6.1 用 DO block 檢查 `pg_publication_tables`，逐一加入 `tasks` / `events` / `system_meta` 到 `supabase_realtime`
- [ ] 6.2 確認 DO block 重複執行不報錯

## 7. 移除 guestbook

- [ ] 7.1 `DROP TABLE public.messages`
- [ ] 7.2 在 migration 註解記錄：前端會在 Phase 2 重寫後恢復

## 8. 部署

- [ ] 8.1 `supabase db push --remote --dry-run` 確認只有一個 migration 待推
- [ ] 8.2 `supabase db push --remote --yes`
- [ ] 8.3 `supabase db diff --remote --schema public` 應返回 no schema changes
- [ ] 8.4 `supabase migration list --remote` 確認 local 與 remote 一致

## 9. 驗證（對應 acceptance criteria）

- [ ] 9.1 anon key 對三張表 SELECT → 回 401 permission denied（或 0 行），任何情況都拿不到資料
- [ ] 9.2 anon key 對 `tasks` INSERT → 被拒
- [ ] 9.3 用 owner session 的 JWT 對 `tasks` SELECT → 成功（以 SQL Editor 模擬 `request.jwt.claims` 或使用真實登入後 token）
- [ ] 9.4 owner session 對 `tasks` DELETE → 被拒
- [ ] 9.5 owner session 對 `events` UPDATE → 被拒
- [ ] 9.5b owner session 對 `tasks` 改 `created_at` → 被拒（column-level update grant）
- [ ] 9.6 手動 UPDATE 一筆 task → `updated_at` 改變
- [ ] 9.6b 任務 done → todo → `completed_at` 變回 NULL；由 NULL 轉 done 時自動填入
- [ ] 9.7 插入兩筆相同 `source_ref` → 第二筆被拒
- [ ] 9.8 插入兩筆 `source_ref` 為 NULL → 兩筆都成功
- [ ] 9.9 插入 `status='park'` 成功；`status='waiting'` 被拒
- [ ] 9.10 查 `pg_publication_tables` → 三張表都在 `supabase_realtime`
- [ ] 9.11 查 `pg_policies` → tasks 3 條、events 1 條、system_meta 1 條
- [ ] 9.12 查 `pg_class.relreplident` for `events` → `f`

## 10. 收尾

- [ ] 10.1 清理驗證期間插入的測試資料
- [ ] 10.2 `openspec validate "add-command-center-schema" --strict` 通過
- [ ] 10.3 更新 `AGENTS.md`：加入三張表的用途與「events 只讀」規則
- [ ] 10.4 commit + push（只含 migration 與 openspec artifacts，不含前端改動）
