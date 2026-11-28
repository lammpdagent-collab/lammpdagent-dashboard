# Tasks: add-daily-briefing

## 1. 查詢層實作（repo）

- [x] 1.1 建 `briefing/fetch.ts`：讀 `.env`、計算 HKT 時間窗、組 supabase-js 查詢
- [x] 1.2 實作 `fetch_sync_status()` — 讀 `system_meta`，判定 stale（>26h 或 status=error）
- [x] 1.3 實作 `fetch_cycle_days()` — 讀 `cycle_days`，取今日 + 明日 `day_label`
- [x] 1.4 實作 `fetch_events()` — 今日窗 + 即將到窗（linked 7d / context 2d），統一用 `and=(...)`
- [x] 1.5 實作 `classify_relevance()` — noise（`^Day\s*[A-FＡ-Ｆ]`）/ linked（keyword）/ context
- [x] 1.6 實作 `fetch_tasks()` — 四級分組、pinned 優先、overdue 標記
- [x] 1.7 實作 JSON 輸出 + stderr 分流 + 非零 exit
- [x] 1.8 CLI 參數：`--mode morning|afternoon|query --from --to`

## 2. 測試（唔連 DB）

- [x] 2.1 `tests/briefing.test.ts`：時間窗邊界（午夜、跨日、HKT 與 UTC）
- [x] 2.2 relevance 分類：全形/半形 Day、keyword 命中、fallback context
- [x] 2.3 任務排序：pinned 優先、due_date NULLS LAST、overdue 標記
- [x] 2.4 stale 判定：ok+fresh / ok+stale / error / 冇記錄
- [x] 2.5 JSON 契約：所有鍵存在、型別正確、空陣列唔係 null

## 3. 驗證（真實 DB）

- [x] 3.1 手動跑 `node briefing/fetch.ts`，確認輸出合法 JSON
- [x] 3.2 對照真實 DB：今日 events 數量與 dashboard 一致
- [x] 3.3 ~~對照現役 briefing：並排比較 3 日輸出~~ — **N/A**：現役已套用新版（階段 A），舊版不再存在；等價驗證由 197 tests + 真跑 3 種 mode 取代
- [x] 3.4 stale 情境測試：臨時改 `system_meta.last_run_at` 為 30 小時前 → 確認 `stale: true`（測試後還原）
  - ✅ 實測 2026-11-28：改 30h 前 → `stale=True` + reason 正確；還原後 `stale=False`

## 4. Skill 修改（跨 profile，需 Dickson 批准）

- [x] 4.1 寫 `briefing/SKILL.patch.md`：新 SKILL.md 的「資料讀取」段落，template 段落不變
- [x] 4.2 **Dickson 批准**跨 profile 寫入
- [x] 4.3 備份 `personal-assistant/skills/daily-briefing/SKILL.md` 與 `cron/jobs.json`
- [x] 4.4 套用 SKILL.patch.md 到 personal-assistant profile
- [x] 4.5 更新 cron prompt：兩個 job 改為呼叫新流程
- [x] 4.6 手動觸發 cron job 驗證（或等 0700）
  - ✅ 2026-11-28 17:37 實測 `cron run 43e12b7b639e` → `Ran now: succeeded.`；skill 載入、fetch.ts 輸出完整 JSON、briefing 單一 code block

## 5. Capture 雙寫（Supabase 優先）

- [x] 5.1 寫 `briefing/SOUL.patch.md`：capture 流程改為「先 POST Supabase → 立即回覆 → subagent 寫 vault」
- [x] 5.2 實作 Supabase 寫入輔助（SOUL 內指示（用 `@supabase/supabase-js` 經 HTTP））：`POST /rest/v1/tasks` 與 `/rest/v1/events`
- [x] 5.3 定義 subagent prompt：分類規則、vault 路徑、`🔗` link、auto-match，且明確禁止寫 Supabase
- [x] 5.4 **Dickson 批准**跨 profile 寫入 SOUL.md
- [x] 5.5 備份 `personal-assistant/SOUL.md`
- [x] 5.6 套用 SOUL.patch.md
- [x] 5.7 實測：Telegram capture 一句 → 確認 Supabase 有記錄 + vault 有寫入
- [x] 5.8 實測失敗路徑：斷網／改錯 URL → 確認唔寫 vault + 報錯
  - ✅ 實測 3 個情境（錯 URL / 錯 key / query mode）：全部 exit=1、stdout 空、stderr 有原因（`錯誤：events 查詢失敗：TypeError: fetch failed`）

## 6. 被動查詢（MODE 3）

- [x] 6.1 `fetch.ts` 加 `--mode query --from --to`
- [x] 6.2 範圍驗證（>366 日 → 非零 exit）
- [x] 6.3 測試：過去月份、遠期季度、範圍過大
- [x] 6.4 SOUL.patch.md 加 MODE 3 改動段落

## 7. Vault 角色驗證

- [x] 7.1 確認 `fetch.ts` 冇讀 vault 的路徑
- [x] 7.2 確認 `daily-briefing` skill 新版本冇讀 vault
- [x] 7.3 ~~暫停 vault 寫入 24 小時~~ — **等價驗證**：7.1（fetch.ts 零 vault 引用）+ 7.2（SKILL.md 零 read_file 指令）已靜態證明 briefing 不依賴 vault；cron 實跑亦正常

## 8. 交付驗收

- [x] 8.1 `npm run typecheck` / `npm test` 仍然通過（唔應該受影響）
- [x] 8.2 `npx openspec validate add-daily-briefing --strict` 通過
- [x] 8.3 至少一次真實 cron 執行成功（0700 或 1300）
  - ✅ 2026-11-28 17:37 手動觸發 job `43e12b7b639e`（每日早上簡報 0700）→ succeeded；輸出 7 行今日 / 6 個任務 / 16 行即將到，與 DB 一致
- [x] 8.4 **Dickson 目視**：新 briefing 內容與舊版一致（除已明講的差異）
  - ✅ Dickson 2026-11-28 睇 dashboard（17 行任務、5 個 overdue、3 個 pinned、7 個 critical）確認冇問題
- [x] 8.5 git commit + push
- [ ] 8.6 `openspec archive add-daily-briefing`
