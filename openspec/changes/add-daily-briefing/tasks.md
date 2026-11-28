# Tasks: add-daily-briefing

## 1. 查詢層實作（repo）

- [ ] 1.1 建 `briefing/fetch.py`：讀 `.env`、計算 HKT 時間窗、組 PostgREST 請求
- [ ] 1.2 實作 `fetch_sync_status()` — 讀 `system_meta`，判定 stale（>26h 或 status=error）
- [ ] 1.3 實作 `fetch_cycle_days()` — 讀 `cycle_days`，取今日 + 明日 `day_label`
- [ ] 1.4 實作 `fetch_events()` — 今日窗 + 即將到窗（linked 7d / context 2d），統一用 `and=(...)`
- [ ] 1.5 實作 `classify_relevance()` — noise（`^Day\s*[A-FＡ-Ｆ]`）/ linked（keyword）/ context
- [ ] 1.6 實作 `fetch_tasks()` — 四級分組、pinned 優先、overdue 標記
- [ ] 1.7 實作 JSON 輸出 + stderr 分流 + 非零 exit
- [ ] 1.8 CLI 參數：`--mode morning|afternoon|manual`

## 2. 測試（唔連 DB）

- [ ] 2.1 `tests/test_briefing.py`：時間窗邊界（午夜、跨日、HKT 與 UTC）
- [ ] 2.2 relevance 分類：全形/半形 Day、keyword 命中、fallback context
- [ ] 2.3 任務排序：pinned 優先、due_date NULLS LAST、overdue 標記
- [ ] 2.4 stale 判定：ok+fresh / ok+stale / error / 冇記錄
- [ ] 2.5 JSON 契約：所有鍵存在、型別正確、空陣列唔係 null

## 3. 驗證（真實 DB）

- [ ] 3.1 手動跑 `python briefing/fetch.py`，確認輸出合法 JSON
- [ ] 3.2 對照真實 DB：今日 events 數量與 dashboard 一致
- [ ] 3.3 對照現役 briefing：並排比較 3 日輸出
- [ ] 3.4 stale 情境測試：臨時改 `system_meta.last_run_at` 為 30 小時前 → 確認 `stale: true`（測試後還原）

## 4. Skill 修改（跨 profile，需 Dickson 批准）

- [ ] 4.1 寫 `briefing/SKILL.patch.md`：新 SKILL.md 的「資料讀取」段落，template 段落不變
- [ ] 4.2 **Dickson 批准**跨 profile 寫入
- [ ] 4.3 備份 `personal-assistant/skills/daily-briefing/SKILL.md` 與 `cron/jobs.json`
- [ ] 4.4 套用 SKILL.patch.md 到 personal-assistant profile
- [ ] 4.5 更新 cron prompt：兩個 job 改為呼叫新流程
- [ ] 4.6 手動觸發 cron job 驗證（或等 0700）

## 5. Capture 雙寫（Supabase 優先）

- [ ] 5.1 寫 `briefing/SOUL.patch.md`：capture 流程改為「先 POST Supabase → 立即回覆 → subagent 寫 vault」
- [ ] 5.2 實作 Supabase 寫入輔助（`briefing/write.py` 或 SOUL 內指示）：`POST /rest/v1/tasks` 與 `/rest/v1/events`
- [ ] 5.3 定義 subagent prompt：分類規則、vault 路徑、`🔗` link、auto-match，且明確禁止寫 Supabase
- [ ] 5.4 **Dickson 批准**跨 profile 寫入 SOUL.md
- [ ] 5.5 備份 `personal-assistant/SOUL.md`
- [ ] 5.6 套用 SOUL.patch.md
- [ ] 5.7 實測：Telegram capture 一句 → 確認 Supabase 有記錄 + vault 有寫入
- [ ] 5.8 實測失敗路徑：斷網／改錯 URL → 確認唔寫 vault + 報錯

## 6. 被動查詢（MODE 3）

- [ ] 6.1 `fetch.py` 加 `--mode query --from --to`
- [ ] 6.2 範圍驗證（>366 日 → 非零 exit）
- [ ] 6.3 測試：過去月份、遠期季度、範圍過大
- [ ] 6.4 SOUL.patch.md 加 MODE 3 改動段落

## 7. Vault 角色驗證

- [ ] 7.1 確認 `fetch.py` 冇讀 vault 的路徑
- [ ] 7.2 確認 `daily-briefing` skill 新版本冇讀 vault
- [ ] 7.3 暫停 vault 寫入 24 小時，確認 briefing / dashboard 照常運作

## 8. 交付驗收

- [ ] 8.1 `npm run typecheck` / `npm test` 仍然通過（唔應該受影響）
- [ ] 8.2 `npx openspec validate add-daily-briefing --strict` 通過
- [ ] 8.3 至少一次真實 cron 執行成功（0700 或 1300）
- [ ] 8.4 **Dickson 目視**：新 briefing 內容與舊版一致（除已明講的差異）
- [ ] 8.5 git commit + push
- [ ] 8.6 `openspec archive add-daily-briefing`
