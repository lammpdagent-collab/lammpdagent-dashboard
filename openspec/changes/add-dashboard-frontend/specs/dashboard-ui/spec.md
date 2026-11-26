## ADDED Requirements

### Requirement: 前端只容許 owner 以 Google 登入後讀取資料

系統 SHALL 要求使用者先以 Supabase Auth 的 Google provider 登入，且只接受預先設定的 owner email；未登入或非 owner 者不得見到任何任務或事件資料。

#### Scenario: 未登入時顯示登入畫面

- **WHEN** 使用者在無 session 的狀態下開啟頁面
- **THEN** 只顯示「使用 Google 登入」按鈕，不發出任何資料查詢

#### Scenario: 非 owner 帳號登入

- **WHEN** 使用者以非 owner 的 Google 帳號完成 OAuth
- **THEN** 前端呼叫 RPC `is_owner()` 得到 `false`，頁面顯示無法存取與「改用其他帳戶」，且不出現任何任務或事件內容

#### Scenario: 權限判斷不依賴前端硬編 email

- **WHEN** 檢查前端 production bundle
- **THEN** bundle 內不含任何 owner email 字面值；owner 判斷只透過 RPC `is_owner()` 完成

#### Scenario: session 過期時自動嘗試續期

- **WHEN** 已登入使用者的 JWT 過期而頁面仍在開啟狀態
- **THEN** 前端先透過 `onAuthStateChange` 自動 refresh，成功則使用者不察覺；失敗才顯示「請重新登入」

### Requirement: 任務列表按固定優先順序排列

系統 SHALL 在每次渲染任務列表時，依下列順序排序：`pinned` 為真者先、其次 `status='park'`、其次 `priority`（`critical` → `high` → `medium` → `low`）、同級內 `due_date` 近者先（NULL 排最後）、再按 `created_at` 由新到舊。

#### Scenario: pinned 任務永遠在最前

- **WHEN** 存在一個 `pinned=true, priority='low'` 的任務與一個 `pinned=false, priority='critical'` 的任務
- **THEN** `pinned=true` 的任務排在前面

#### Scenario: park 排在 critical 之前

- **WHEN** 存在 `status='park', priority='low'` 與 `status='todo', priority='critical'` 兩個任務
- **THEN** `park` 的任務排在 `critical` 之前

#### Scenario: 無 due_date 的任務排在同級最後

- **WHEN** 兩個同 `priority` 的任務，一個 `due_date='2026-12-01'`，一個 `due_date=NULL`
- **THEN** 有 `due_date` 的排前面

### Requirement: 完成狀態以再點擊切換，不設 Undo

系統 SHALL 讓使用者點擊任務行的勾選框把 `status` 由 `todo` 改為 `done`（同時由 trigger 寫入 `completed_at`），再次點擊同一勾選框則改回 `todo`（由 trigger 清除 `completed_at`）。不提供 Undo toast 或計時器。

#### Scenario: 點擊勾選框完成任務

- **WHEN** 使用者點擊一個 `status='todo'` 任務的勾選框
- **THEN** 該任務 `status` 變為 `done`，`completed_at` 被寫入，行外觀變灰並加刪除線，位置移至列表最後

#### Scenario: 再點一次取消完成

- **WHEN** 使用者點擊一個 `status='done'` 任務的勾選框
- **THEN** 該任務 `status` 變回 `todo`，`completed_at` 變為 NULL，行恢復正常外觀並按排序規則重新定位

#### Scenario: 取消完成後不保留原本的 park 狀態

- **WHEN** 一個原為 `status='park'` 的任務被完成後再取消完成
- **THEN** 該任務 `status` 為 `todo`（不還原為 `park`）；要改回 `park` 須經其他途徑

#### Scenario: 完成的任務只保留當日

- **WHEN** 頁面載入時查詢任務
- **THEN** 只取 `status <> 'done'` 或 `completed_at` 屬於今日的記錄；昨日或更早完成的任務不會出現在列表

### Requirement: 任務可新增並展開行內編輯

系統 SHALL 容許使用者新增任務（只需輸入標題），並透過點擊任務行展開該行的編輯區，修改 `title`、`notes`、`due_date`、`priority`、`category` 與 tags。編輯採即時儲存：離開欄位即寫入資料庫，無「儲存」按鈕。

#### Scenario: 只輸入標題即可新增

- **WHEN** 使用者輸入標題並確認
- **THEN** 任務以 `priority='medium'`、`status='todo'`、`category='work'`、`source='web'` 寫入，並即時出現在列表

#### Scenario: 展開任務行見到可編輯欄位

- **WHEN** 使用者點擊一個任務行
- **THEN** 該行展開，顯示 `notes`（自動高度 textarea）、`due_date`、`priority`、`category` 與 tag 清單；其他行同時收起

#### Scenario: 編輯後離開欄位即寫入

- **WHEN** 使用者修改 `priority` 由 `medium` 改為 `high` 並把焦點移離該控制項
- **THEN** 前端立即發出 UPDATE，DB 的 `priority` 變為 `high`，且無需任何額外確認

#### Scenario: 寫入被拒絕時還原並提示

- **WHEN** UPDATE 因權限或網絡問題失敗
- **THEN** 該欄位還原為修改前的值，並顯示「⚠️ 儲存失敗，已還原」toast（3 秒後消失）

### Requirement: Tag 以純點選方式操作，不設自由輸入框

系統 SHALL 在展開的任務行顯示 tag 清單：該任務已選取的 tag 置於最前並以高亮標示，其餘 tag 按使用次數由多到少排序、同次數按字母排序。點擊未選取的 tag 即加入該任務，點擊已選取的 tag 即移除；不得使用 `×` 圖示，亦不得提供自由輸入框（除 tag 目錄的「+ 新增」操作）。

#### Scenario: 已選取的 tag 置前並高亮

- **WHEN** 一個任務的 `tags` 為 `{SEN}`，目錄另有 `PSMCD`、`學教組`
- **THEN** `SEN` 顯示在最前並高亮，其餘兩個按使用次數排序

#### Scenario: 點擊加入 tag

- **WHEN** 使用者點擊未選取的 `學教組`
- **THEN** 該任務的 `tags` 立即包含 `學教組`，該 tag 移到最前並變為高亮

#### Scenario: 再點擊移除 tag

- **WHEN** 使用者點擊已選取的 `學教組`
- **THEN** 該任務的 `tags` 不再包含 `學教組`，該 tag 回到未選取區並恢復按使用次數排序

#### Scenario: 新增 tag 後輸入框收起

- **WHEN** 使用者使用「+ 新增」輸入新 tag 並按 Enter
- **THEN** 該 tag 寫入 `public.tags` 並立即選取於當前任務，輸入框收起

### Requirement: 刪除任務須兩步確認

系統 SHALL 在刪除任務時要求使用者確認一次才執行（第一步為展開區的「刪除任務」，第二步為確認對話）。刪除以設定 `deleted_at` 實作，不發出 DELETE 請求。

#### Scenario: 第一步不會即時刪除

- **WHEN** 使用者在展開區點擊「刪除任務」
- **THEN** 出現確認對話，任務仍然存在

#### Scenario: 確認後才寫入 deleted_at

- **WHEN** 使用者在確認對話中確認
- **THEN** 該任務的 `deleted_at` 被寫入，並從列表移除

#### Scenario: 取消確認

- **WHEN** 使用者在確認對話中取消
- **THEN** 任務保持不變

### Requirement: 事件按 Today / Tomorrow / Upcoming 分組並支援跨日重疊

系統 SHALL 把事件分為「今日」「聽日」「Upcoming」三組，Upcoming 顯示範圍為今日起**第 2 至第 6 日**（即後日開始，合共五個日曆日；連同今日與聽日總計七日）。查詢窗口為 `start_time < 今日 + 7 日`。Upcoming 內每個有事件的日期 SHALL 以 `DD/MM（星期）` 格式顯示小標題。

任何與今日有重疊的事件（`start_time < 今日 00:00 AND end_time > 今日 00:00`）必須出現在「今日」組。

#### Scenario: 全日事件排在該日最前

- **WHEN** 某日同時有一個 `is_all_day=true` 的事件與一個 `09:00` 的事件
- **THEN** 全日事件排前面並標示「全日」

#### Scenario: 已過時間的事件變灰

- **WHEN** 現在時間為 14:30，今日有一個 09:00 的事件
- **THEN** 該事件仍然顯示，但外觀變灰

#### Scenario: 跨日活動第二天仍顯示

- **WHEN** 存在一個 11/26 14:00 – 11/27 12:00 的事件，而今日為 11/27 10:00
- **THEN** 該事件出現在「今日」組並標示「進行中（至 12:00）」

#### Scenario: 跨日活動結束後變灰

- **WHEN** 同一事件，今日為 11/27 15:00（已結束）
- **THEN** 該事件仍然出現在「今日」組，但不標示「進行中」，外觀變灰

#### Scenario: 已取消事件完全不顯示

- **WHEN** 事件的 `cancelled_at` 非 NULL
- **THEN** 該事件不出現在任何分組

#### Scenario: 後日的事件不會被漏掉

- **WHEN** 一個事件位於今日 + 2 日
- **THEN** 該事件出現在 Upcoming 組，並歸於該日期的小標題之下

#### Scenario: Upcoming 逐日小標題

- **WHEN** Upcoming 內有 29/11 與 01/12 兩個日期各有事件
- **THEN** 分別顯示「29/11（日）」與「01/12（一）」作為小標題，事件列於其下

### Requirement: 事件顯示以一個列表呈現並以 💼 / 🏠 分組

系統 SHALL 以單一列表呈現事件，不並排兩個日曆。每行依 `account_key` 標示 `work` 為 💼、`personal` 為 🏠。`account_key='personal'` 且標題（trim 後）與某 `account_key='work'` 事件相同、且 `start_time` 差距不超過 5 分鐘者，視為 clone 副本，不予渲染。

#### Scenario: 學校與私人事件在同一列表

- **WHEN** 今日有一個 `account_key='work'` 的會議與一個 `account_key='personal'` 的私人約會
- **THEN** 兩者出現在同一「今日」組，分別標示 💼 與 🏠

#### Scenario: clone 副本不重複顯示

- **WHEN** 私人日曆存在一個與學校日曆同標題、`start_time` 相差 1 分鐘的事件
- **THEN** 只顯示學校那份，私人那份不渲染

#### Scenario: 標題差異過大時不視為副本

- **WHEN** 兩個事件的標題不同（例如一個含括號備註）
- **THEN** 兩者都顯示（寧可多一行，不可漏資料）

### Requirement: relevance 過濾在 Upcoming 生效

系統 SHALL 在 Upcoming 組只顯示 `relevance='linked'` 的事件；今日與聽日兩組不受此限制。

#### Scenario: 全部為 context 時 Upcoming 沒有可顯示事件

- **WHEN** 所有事件的 `relevance` 皆為預設 `context`
- **THEN** 「今日」與「聽日」正常顯示；Upcoming 區塊**仍然顯示標題**並標示「無事件」（不隱藏區塊）

#### Scenario: 有 linked 事件時 Upcoming 出現

- **WHEN** 一個 4 日後的事件 `relevance='linked'`
- **THEN** 該事件出現在 Upcoming 組

### Requirement: 同步異常才顯示提示

系統 SHALL 在同步狀態正常時完全不顯示同步資訊。當任一來源符合下列條件時，才在頁面頂部以黃色細字加 ⚠️ 顯示該來源：`status='error'`、`status='stale'`、或 `last_run_at` 距今超過 24 小時（由前端計算）。`status='init'` 於 24 小時內不顯示。

#### Scenario: 一切正常時不顯示任何同步資訊

- **WHEN** 兩個來源的 `status='ok'` 且 `last_run_at` 都在 1 小時內
- **THEN** 頁面不出現任何同步相關文字

#### Scenario: 單一來源逾 24 小時

- **WHEN** `calendar_sync:work` 的 `last_run_at` 為 26 小時前
- **THEN** 頂部顯示「⚠️ 學校日曆 26 小時未更新」，私人來源不提及

#### Scenario: 來源回報錯誤

- **WHEN** `calendar_sync:personal` 的 `status='error'`
- **THEN** 頂部顯示「⚠️ 私人日曆更新失敗」

#### Scenario: 來源主動標記 stale

- **WHEN** `calendar_sync:work` 的 `status='stale'` 而 `last_run_at` 只過了 2 小時
- **THEN** 頂部仍然顯示該來源的警告（不因未滿 24 小時而靜默）

#### Scenario: 首次部署的 init 狀態不告警

- **WHEN** `calendar_sync:work` 的 `status='init'` 且 `last_run_at` 在 1 小時內
- **THEN** 不顯示任何同步提示

### Requirement: 時間一律以 Asia/Hong_Kong 及固定格式顯示

系統 SHALL 以硬編時區 `Asia/Hong_Kong` 格式化所有時間，不依賴裝置時區。時間採 24 小時制、格式 `HH:MM`；事件顯示 `10:10 – 11:55`；分組標題顯示 `今日 26/11（三）`（DD/MM）；全日事件顯示「全日」，不得出現 `00:00`。

#### Scenario: 裝置時區非香港時仍顯示香港時間

- **WHEN** 裝置時區設為 UTC 而事件 UTC 時間為 `02:10Z`
- **THEN** 畫面顯示 `10:10`

#### Scenario: 全日事件不出現 00:00

- **WHEN** 事件的 `is_all_day=true`
- **THEN** 顯示「全日」，不顯示任何 `00:00` 字樣

#### Scenario: 頂部顯示今日循環日

- **WHEN** `cycle_days` 存在今日的記錄且 `day_label='A'`
- **THEN** 頁面頂部顯示「今日 Day A」

#### Scenario: 假期無循環日記錄

- **WHEN** `cycle_days` 無今日的記錄
- **THEN** 頁面頂部不顯示循環日，亦不報錯

### Requirement: 錯誤、載入與空狀態皆有明確反饋

系統 SHALL 在初次載入失敗時顯示全頁錯誤與重試按鈕；載入期間顯示骨架屏；各區塊無資料時顯示細字空狀態。

#### Scenario: 初次載入失敗

- **WHEN** 初次查詢因網絡中斷失敗
- **THEN** 全頁顯示「載入失敗 / 請檢查網絡連線」與「重試」按鈕

#### Scenario: 載入中顯示骨架屏

- **WHEN** 頁面已開始查詢但資料未返回
- **THEN** 顯示灰色佔位塊，不顯示空白頁

#### Scenario: 今日無任務

- **WHEN** 沒有任何任務符合載入條件
- **THEN** 任務區顯示「暫無任務」，事件區仍正常顯示

### Requirement: 兩部裝置的變更即時同步

系統 SHALL 訂閱 `supabase_realtime` 上 `tasks`、`events`、`system_meta`、`tags`、`cycle_days` 的變更，並在收到變更時更新畫面，使另一部裝置的改動在 500ms 內反映。

#### Scenario: 電話完成的任務在電腦消失於未完成區

- **WHEN** 使用者在手機把一個任務標為完成
- **THEN** 已開啟的電腦頁面在 500ms 內把該任務移到已完成位置並變灰

#### Scenario: 新增 tag 同步到另一部裝置

- **WHEN** 使用者在電腦新增一個 tag
- **THEN** 手機的 tag 清單在 500ms 內出現該 tag
