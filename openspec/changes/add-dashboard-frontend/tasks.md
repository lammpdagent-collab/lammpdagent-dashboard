## 1. Migration（Phase 1b）

- [x] 1.1 新增 `supabase/migrations/<timestamp>_create_tags_and_cycle_days.sql`：建 `public.tags`（`name` PK、`created_at`）與 `public.cycle_days`（`date` PK、`day_label`、`updated_at`），含 CHECK 約束
- [x] 1.2 為兩表設 RLS：`tags` 容許 owner 的 `authenticated` select / insert / delete；`cycle_days` 只容許 select；`anon` 一律 `revoke all`
- [x] 1.3 為兩表加 grants；`tags` 與 `cycle_days` **都**加入 `supabase_realtime` publication（用 idempotent DO block）
- [x] 1.3b 新增 `public.is_owner()` function（`security definer`、`set search_path = ''`），回傳 JWT email 是否等於 owner；`revoke all from public, anon`，`grant execute to authenticated`
- [x] 1.4 本地 `supabase db diff` 確認無 drift；`openspec validate add-dashboard-frontend --strict` 通過
- [x] 1.5 經 Dickson 批准後 `supabase db push --remote`，並以 SQL 驗證兩表存在、約束生效、anon 被拒

## 2. 前端骨架

- [x] 2.1 移除 guestbook 相關 `src/` 檔案與 `tests/` 中的 guestbook 測試
- [x] 2.2 建立 TypeScript 型別（`Task`、`Event`、`SystemMeta`、`Tag`、`CycleDay`），對應 Phase 1 migration 的欄位
- [x] 2.3 建立 Supabase client 與 Google 登入流程（`signInWithOAuth`），未登入時只顯示登入按鈕
- [x] 2.3b 登入後呼叫 RPC `is_owner()`；回 `false` 則顯示無法存取 + 「改用其他帳戶」
- [x] 2.4 建立 `onAuthStateChange` 自動 refresh；失敗才顯示重新登入提示
- [x] 2.5 建立初始載入（五張表 + 當日 cycle day）與骨架屏
- [x] 2.6 建立 Realtime 訂閱（`tasks`、`events`、`system_meta`、`tags`、`cycle_days`）與重連後重新載入

## 3. 任務區

- [x] 3.1 實作載入條件（未完成 + 當日完成）與排序（pinned → park → priority → due_date → created_at）
- [x] 3.2 實作勾選框切換完成／取消（含樂觀更新與失敗 rollback）；取消完成後 `status` 一律回 `todo`，不還原 `park`
- [x] 3.3 實作新增任務（只輸入標題，預設值由 DB 提供）
- [x] 3.4 實作點擊展開行內編輯（title / notes / due_date / priority / category），離開欄位即寫入
- [x] 3.5 實作 soft delete（設 `deleted_at`）：展開區「刪除任務」→ 確認對話 → 列表即時移除
- [x] 3.6 實作 tag 點選清單（已選置前高亮、按使用次數排序、無 `×`）
- [x] 3.7 實作「+ 新增 tag」（寫入 `public.tags` 並即時選取，Enter 後收起輸入框）

## 4. Tag 目錄管理

- [x] 4.1 實作目錄管理介面（可新增、可移除）
- [x] 4.2 移除未使用的 tag：直接刪除 `public.tags` 該行
- [x] 4.3 移除使用中的 tag：先彈確認並顯示影響任務數；確認後批量 `array_remove` 再刪目錄行

## 5. 事件區

- [x] 5.1 實作查詢條件（`cancelled_at is null`、`end_time > 今日00:00`、`start_time < 今日+7日`）
- [x] 5.2 實作 clone 副本過濾（`personal` 與 `work` 同標題且 `start_time` ≤5 分鐘）
- [x] 5.3 實作 Today / Tomorrow / Upcoming 分組（Upcoming = **第 2–6 日**，逐日小標題 `29/11（日）`）
- [x] 5.4 實作跨日重疊顯示（與今日重疊即入今日組，未結束標「進行中」）
- [x] 5.5 實作已過事件變灰、全日事件置頂標「全日」
- [x] 5.6 實作 relevance 過濾（Upcoming 只顯示 `linked`）；Upcoming 無可顯示事件時仍顯示標題 + 「無事件」
- [x] 5.7 實作 💼 / 🏠 標示（依 `account_key`）

## 6. 監控與體驗

- [x] 6.1 實作同步狀態判斷（`status` 與 `last_run_at`），異常才顯示 ⚠️
- [x] 6.2 實作時間格式化工具（硬編 `Asia/Hong_Kong`、24 小時、`10:10 – 11:55`、`26/11（三）`）
- [x] 6.3 實作頂部今日循環日（讀 `cycle_days`）
- [x] 6.4 實作四類錯誤處理（載入失敗全頁、寫入失敗 toast、空狀態細字、骨架屏）
- [x] 6.5 加入 `manifest.json`（PWA，不註冊 service worker）與手機 meta viewport
- [x] 6.6 實作響應式排版（手機單欄）

## 7. 測試與驗證

- [x] 7.1 單元測試：排序邏輯、clone 副本判定、跨日重疊判定、時間格式化
- [x] 7.2 `npm run typecheck` 通過
- [x] 7.3 `npm test` 全綠
- [x] 7.4 `npm run build` 成功
- [ ] 7.5 手動驗證（Dickson 執行）：登入、剔完成、再點取消、展開編輯、tag 選取、新增 tag、移除使用中 tag
- [ ] 7.6 手動驗證：事件分組、跨日活動、已過變灰、同步警告（可手動改 `system_meta` 製造）
- [x] 7.7 更新 `AGENTS.md` 的資料表清單（加 `tags`、`cycle_days`）
