/**
 * DOM 綁定層 —— Phase 2 Step 12 全量接線。純邏輯一律喺 src/lib/；
 * 本檔只做 state → DOM render、事件委派、IO 呼叫嘅 orchestration。
 *
 * Boot 流程（plan §4.9）：
 *   getSupabase()（env 缺 → 全頁錯誤）→ 事件委派 → onAuthStateChange →
 *   INITIAL_SESSION / SIGNED_IN / 「重試」→ enterReady()（M1：共用同一條路）：
 *   resolveCurrentView()（登入閘）→ login / blocked / error 就停
 *   （零資料查詢、零訂閱）；ready → 先訂閱 realtime（m5，唔等 initial load）→
 *   loadAll() → startClock()（M3：60s tick + 跨日 resync）。
 *
 * Render 模型：store.subscribe → scheduleRender（microtask 合併同 tick 多次 setState；
 * IME 組字期間 defer，compositionend／blur 才 flush，m8）→ 全量重繪 #app。
 * 焦點保全：render 前 captureFocus（activeElement 嘅 data-field/data-task-id +
 * caret + 未 commit 草稿），render 後 restoreFocus——realtime 更新唔會食走
 * 打字中嘅焦點。草稿只保留「真係 dirty」值（M2）：capture 時對照 store state
 * 欄位值，state 變過（rollback／遠端更新）就唔再覆蓋，唔會將失敗值寫返上 DOM。
 *
 * 互動模型：pointerdown 統一處理任務行／動作按鈕／tag chip——preventDefault 防搶焦點、
 * 先落實焦點欄位再行動，避免「focusout → commit → render → click 目標被換走」令點擊
 * 失效；click 只做鍵盤啟用（Enter/Space）後備，同一元素經 pointerdown 處理過就 suppress。
 */
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import {
  deleteTag,
  fetchEvents,
  fetchSystemMeta,
  fetchTags,
  fetchTaskRowsWithTag,
  fetchTaskTagRows,
  fetchTasks,
  fetchTodayCycleDay,
  insertTag,
  insertTask,
  updateTask,
  updateTaskTags,
  type TaskPatch,
} from './lib/api'
import { resolveCurrentView, signIn } from './lib/auth'
import { isDraftDirty } from './lib/draft'
import { buildEventWindow, eventState, filterClones, groupEvents } from './lib/eventQuery'
import { subscribeRealtime, type RealtimeHandle } from './lib/realtime'
import { shouldResyncNow } from './lib/resync'
import {
  createInitialState,
  createStore,
  mergeTag,
  mergeTask,
  optimisticUpdate,
  type AppState,
  type OptimisticTaskPatch,
} from './lib/store'
import { syncWarnings } from './lib/syncStatus'
import { orderTagsForTask, stripTag, toggleTagOnTask, validateTagName } from './lib/tagCatalog'
import { isVisibleTask, sortTasks, tagUsageCounts, toggleStatus } from './lib/taskQuery'
import {
  addDays,
  formatDdMm,
  formatGroupTitle,
  formatHm,
  formatRange,
  hkTodayDateString,
} from './lib/time'
import type {
  CycleDayRow,
  EventRow,
  SystemMetaRow,
  TagRow,
  TaskRow,
  TaskStatus,
} from './lib/types'
import { getSupabase } from './lib/supabase'

// ---------------------------------------------------------------------------
// 常數與 DOM refs
// ---------------------------------------------------------------------------

/** 寫入失敗統一 toast（§4.11）。 */
const ROLLBACK_TOAST = '⚠️ 儲存失敗，已還原'
const DELETE_CONFIRM_TEXT = '確認刪除任務？任務會從列表移除。'
// m2：唔好一律講「已還原」——按實際發生咗乜講
/** INSERT 本身失敗（新增任務／tag）：乜都冇寫入過，唔存在「還原」。 */
const INSERT_FAILED_TOAST = '⚠️ 新增失敗'
/** 批量移除 tag 中途失敗：前面行已寫入 DB，唔可以話「已還原」。 */
const TAG_PARTIAL_REMOVE_TOAST = '⚠️ 部分任務已更新，目錄未刪除'
/** 批量移除 tag 第一步（撈行）失敗：未寫任何嘢，純粹操作失敗。 */
const ACTION_FAILED_TOAST = '⚠️ 操作失敗，請重試'
// N7：批量移除 tag **第一行**就失敗——一行都未更新過，唔係「部分已更新」。
const TAG_REMOVE_FAILED_TOAST = '⚠️ 移除失敗，請重試'
// N7：insertTag 已成功（tag 已寫入 public.tags，design D2 接受嘅中間態），
// 之後套用到任務失敗——唔係「已還原」，如實講「已入目錄但未套用」。
const TAG_CATALOG_ONLY_TOAST = '⚠️ 標籤已加入目錄，但未能套用到任務'

const PRIORITY_ZH: Record<string, string> = { critical: '緊急', high: '高', medium: '中', low: '低' }
const PRIORITY_OPTIONS: Array<[string, string]> = [
  ['critical', '緊急'],
  ['high', '高'],
  ['medium', '中'],
  ['low', '低'],
]
const CATEGORY_OPTIONS: Array<[string, string]> = [
  ['work', '工作'],
  ['personal', '個人'],
  ['other', '其他'],
]

/** 與 index.html 靜態骨架屏相同嘅標記——loading view 重用（重試時都唔會白屏）。 */
const SKELETON_HTML = `
  <div class="skeleton-screen" aria-hidden="true">
    <div class="skeleton skeleton-bar"></div>
    <div class="skeleton-cols">
      <div class="skeleton skeleton-panel"></div>
      <div class="skeleton skeleton-panel"></div>
    </div>
  </div>`

const app = document.getElementById('app') as HTMLElement
const toastEl = document.getElementById('toast') as HTMLElement
const dialogEl = document.getElementById('confirm-dialog') as HTMLDialogElement
const dialogTextEl = document.getElementById('confirm-text') as HTMLElement

const store = createStore()
store.subscribe(() => scheduleRender())

let client: SupabaseClient | null = null
let realtime: RealtimeHandle | null = null
/** 展開區「＋ 新增」tag 輸入框開緊邊個任務（null = 收起）。屬 UI 局部狀態，唔入 store。 */
let tagInputTaskId: string | null = null
/** render 後要把焦點交俾新開嘅 tag 輸入框（一次性）。 */
let focusTagInputOnce = false
let toastTimer: ReturnType<typeof setTimeout> | undefined
/** pointerdown 已處理嘅元素；其後同元素嘅 click（滑鼠路徑）suppress，鍵盤路徑唔受影響。 */
let suppressedClick: Element | null = null
/** 啱啱成功清空嘅輸入框 id——下一個 render 唔好還原草稿。 */
const skipDraftRestore = new Set<string>()

// m1：主動登出 flag——SIGNED_OUT 分支據此區分「用戶登出」同「refresh 失敗」。
let signingOut = false
// M4：新增任務／目錄 tag in-flight guard（防按住 Enter／double-click 重複提交）。
let addingTask = false
let addingCatalogTag = false
// m6：in-flight 寫入計數；>0 時 resync 延後，歸零先做。
let pendingWrites = 0
let resyncDeferred = false
// N2：最舊一筆 in-flight 寫入嘅開始時間（null = 冇 in-flight 寫入）——
// 偵測卡死（例如 TCP half-open 永遠唔 resolve）嘅寫入，唔好永久鎖死 resync。
let oldestPendingWriteAt: number | null = null
/** N2：pending 寫入超過咁耐就當疑似卡死，resync 唔再等。 */
const RESYNC_STALE_PENDING_MS = 15_000
// m8：IME 組字中——render defer，compositionend／blur 先 flush。
let composing = false
let compositionRenderPending = false
// M3：時鐘 tick（60s）＋跨日偵測；logout / blocked 清走。
let clockTimer: ReturnType<typeof setInterval> | undefined
let lastTodayStr: string | null = null
// M3：focus resync single-flight。
let resyncing = false
// M2：任務欄位 baseline（上次 capture 見到嘅 state 欄位值）——只保留真係 dirty 嘅草稿。
const fieldBaseline = new Map<string, string>()

// ---------------------------------------------------------------------------
// Boot 與認證閘
// ---------------------------------------------------------------------------

function boot(): void {
  wireDelegation()
  wireClockResync()
  try {
    client = getSupabase()
  } catch (error) {
    renderFatal(error instanceof Error ? error.message : '環境設定錯誤')
    return
  }
  client.auth.onAuthStateChange((event, session) => onAuthEvent(event, session))
}

let hadSession = false

function onAuthEvent(event: AuthChangeEvent, session: Session | null): void {
  const has = session !== null
  switch (event) {
    case 'INITIAL_SESSION':
      hadSession = has
      if (has) void enterApp()
      else store.setState({ view: 'login' }) // 無 session → login（零資料查詢、零訂閱）
      break
    case 'SIGNED_IN':
      // entered guard 防 double load：OAuth 回跳時 INITIAL_SESSION + SIGNED_IN 都會 fire
      if (!hadSession) {
        hadSession = true
        void enterApp()
      }
      break
    case 'SIGNED_OUT': {
      // m1：refresh token 失效時 supabase-js 會 _removeSession() → emit SIGNED_OUT，
      // 同用戶主動登出（signOutNow）要區分——後者唔好誤報「請重新登入」。
      const refreshLost = !signingOut && hadSession
      hadSession = false
      signingOut = false
      tagInputTaskId = null
      stopClock() // M3：登出清走時鐘
      void teardownRealtime() // 登出 → 零訂閱
      store.setState({
        ...createInitialState(),
        view: 'login',
        errorMsg: refreshLost ? '請重新登入' : null, // 順便清走所有資料
      })
      break
    }
    default:
      break // TOKEN_REFRESHED → 靜默；refresh 失敗最終會 SIGNED_OUT 或查詢 401
  }
}

let entering = false

/**
 * ready 路徑共用（M1）：登入閘 → 訂閱 realtime → loadAll → 開時鐘。
 * `enterApp`（auth 事件）同「重試」按鈕都行呢條——重試成功一樣會真正 ready
 * 並訂閱 realtime，順便重跑 owner 閘。single-flight 防 double load。
 */
async function enterReady(): Promise<void> {
  if (client === null || entering) return
  entering = true
  try {
    const view = await resolveCurrentView(client)
    if (view !== 'ready') {
      // 閘口唔過（login / blocked / error）→ 零資料查詢、零訂閱、零時鐘
      stopClock()
      void teardownRealtime()
      store.setState({ view, errorMsg: null })
      return
    }
    await ensureRealtime() // m5：先訂閱——initial load 期間其他裝置嘅變更唔會漏
    await loadAll('initial')
    if (store.getState().view === 'ready') startClock() // M3：ready 先開時鐘
  } catch (error) {
    console.warn('[enterReady] 失敗', error)
    stopClock() // N6：catch 係唯一冇清時鐘嘅出口——補返（見上：任何非 ready 出口都唔留時鐘）
    store.setState({ view: 'error', errorMsg: messageOf(error) })
  } finally {
    entering = false
  }
}

async function enterApp(): Promise<void> {
  await enterReady()
}

async function signOutNow(): Promise<void> {
  if (client === null) return
  signingOut = true // m1：主動登出——SIGNED_OUT 分支唔好誤報「請重新登入」
  stopClock() // M3
  await teardownRealtime()
  try {
    await client.auth.signOut()
  } catch (error) {
    console.warn('[auth] signOut 失敗', error)
  }
  tagInputTaskId = null
  store.setState({ ...createInitialState(), view: 'login' }) // SIGNED_OUT event 冇 fire 時都保證返 login
}

// ---------------------------------------------------------------------------
// 資料載入與 realtime
// ---------------------------------------------------------------------------

/**
 * 六個 fetch 全部 Promise.allSettled；任一 reject →
 * initial：auth 錯誤 → 「請重新登入」；其他 → 全頁錯誤（重試）。
 * resync（realtime 重連後）：只 console.warn + 保持舊畫面。
 * 回傳 true = 新資料已套用；false = 失敗或已跳過——N4 跨日 resync 判成敗用。
 */
async function loadAll(mode: 'initial' | 'resync'): Promise<boolean> {
  if (client === null) return false
  // N1：load 前記低 realtime 回呼計數——load 期間有 postgres_changes 闖入嘅話，
  // 該寫入可能喺 fetch 快照之後先 commit，最後整批 setState 會用較舊嘅讀取結果
  // 覆蓋佢（刪除類更明顯：讀取含該行 → DELETE 先移除 → load 又加返）。
  const changesBeforeLoad = realtime?.changeCount() ?? 0
  const now = Date.now()
  const settled = await Promise.allSettled([
    fetchTasks(client, now),
    fetchTaskTagRows(client),
    fetchEvents(client, buildEventWindow(now)),
    fetchTags(client),
    fetchSystemMeta(client),
    fetchTodayCycleDay(client, hkTodayDateString(now)),
  ])
  // N6：fetch 在飛期間若已 SIGNED_OUT（state 已重置成 login、realtime 已 teardown），
  // initial load resolve 後唔可以再寫 state——否則下面 patch.view='ready' 會蓋返
  // login view，變成「login 後又彈返 dashboard，但 realtime 已 teardown」。
  // 失敗／成功兩條路都喺度一早擋住。
  if (mode === 'initial' && store.getState().view === 'login') return false
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failed !== undefined) {
    if (mode === 'initial') {
      if (isAuthError(failed.reason)) {
        stopClock() // M3：session 失效 → login view，時鐘一併清走
        await teardownRealtime()
        store.setState({ view: 'login', errorMsg: '請重新登入' })
      } else {
        store.setState({ view: 'error', errorMsg: messageOf(failed.reason) })
      }
    } else {
      console.warn('[loadAll] 重同步失敗，保留舊畫面', failed.reason)
    }
    return false
  }
  const [tasksR, tagRowsR, eventsR, tagsR, metaR, cycleR] = settled
  const tasks = (tasksR as PromiseFulfilledResult<TaskRow[]>).value
  const tagRows = (tagRowsR as PromiseFulfilledResult<Array<Pick<TaskRow, 'tags' | 'deleted_at'>>>)
    .value
  const events = (eventsR as PromiseFulfilledResult<EventRow[]>).value
  const tags = (tagsR as PromiseFulfilledResult<TagRow[]>).value
  const meta = (metaR as PromiseFulfilledResult<SystemMetaRow[]>).value
  const cycle = (cycleR as PromiseFulfilledResult<CycleDayRow | null>).value
  const patch: Partial<AppState> = {
    tasks: tasks.filter((task) => isVisibleTask(task, Date.now())), // initial 同 merge 共用可見性判斷
    tagUsage: tagUsageCounts(tagRows),
    events: filterClones(events),
    tags,
    meta,
    cycleToday: cycle,
  }
  if (mode === 'initial') patch.view = 'ready' // resync 背景刷新唔改 view、唔閃骨架屏
  store.setState(patch)
  // N1：load 期間有 event 闖入 → 可能已被較舊讀取結果覆蓋 → 再排一次 resync 補返。
  // 行 resyncWhenIdle 唔直接 loadAll：尊重 pendingWrites（m6），寫入 in-flight 時延後。
  // 之後嗰次 load 若再見到新 event 會再排——鏈喺「load 窗口內冇新 event」時自然終止。
  if ((realtime?.changeCount() ?? 0) !== changesBeforeLoad) {
    void resyncWhenIdle().catch((error) =>
      console.warn('[loadAll] 事件闖入後 resync 失敗，保留舊畫面', error),
    )
  }
  return true
}

async function refreshTagUsage(): Promise<void> {
  if (client === null) return
  try {
    const rows = await fetchTaskTagRows(client)
    store.setState({ tagUsage: tagUsageCounts(rows) })
  } catch (error) {
    console.warn('[tagUsage] 重算失敗', error)
  }
}

async function ensureRealtime(): Promise<void> {
  if (realtime !== null || client === null) return
  realtime = subscribeRealtime(client, store, {
    // N4：resyncWhenIdle 而家回傳 boolean（成敗）；realtime reload 唔需要理，
    // 包一層保持 () => void 簽名。m6：pending 寫入歸零先做（resyncWhenIdle 內部判斷）。
    reload: () => {
      void resyncWhenIdle()
    },
    refreshTagUsage: () => refreshTagUsage(),
  })
}

async function teardownRealtime(): Promise<void> {
  if (realtime === null) return
  const handle = realtime
  realtime = null
  await handle.unsubscribe()
}

/** PostgREST 401 / JWT 失效——行「請重新登入」路徑（§4.9）。 */
function isAuthError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'PGRST301' || code === '401') return true
  return error instanceof Error && /(jwt|401|pgrst301|invalid api key)/i.test(error.message)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// 時鐘 tick（M3）——「現在時間」語意要按鐘更新
// ---------------------------------------------------------------------------

const CLOCK_TICK_MS = 60_000

/**
 * ready 之後每 60 秒強制 render 一次（空 patch 就係為咗觸發 listeners）：
 * 事件「已過變灰」「進行中」「24h 警告」按鐘更新；同時偵測跨日——
 * hkTodayDateString() 一變（HK 午夜）就 loadAll('resync') 靜默重新取
 * 任務／事件／循環日。logout / blocked 時 stopClock() 清走（M3）。
 */
function startClock(): void {
  if (clockTimer !== undefined) return
  lastTodayStr = hkTodayDateString()
  clockTimer = setInterval(() => {
    const today = hkTodayDateString()
    if (today !== lastTodayStr) {
      // N4：唔喺度先改 lastTodayStr——resync 成功後（resyncWhenIdle）先更新。
      // 失敗（離線等）保留舊值，下一個 60s tick 見到日期仍然唔夾會自動再試，
      // 唔會出現「標題翻咗頁但資料停留舊窗口直到 focus／visible／online」。
      void resyncNow() // 跨日 → 靜默重新載入（唔閃骨架屏）
      return
    }
    // N5：開住 native picker（<select> 下拉／<input type=date> 日曆彈窗）時，
    // 全量 innerHTML 重繪會閂掉佢——跳過呢次純時間性重繪，下個 tick（picker
    // 閉咗）先恢復。只跳 tick 觸發嘅 render；資料變更（store setState）嘅
    // render 照做，唔受影響。
    const active = document.activeElement
    if (
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLInputElement && active.type === 'date')
    ) {
      return
    }
    store.setState({}) // 強制 render：灰／進行中／警告按時間更新
  }, CLOCK_TICK_MS)
}

function stopClock(): void {
  if (clockTimer === undefined) return
  clearInterval(clockTimer)
  clockTimer = undefined
}

/**
 * M3：visibilitychange(visible)／window focus／跨日 tick 共用——single-flight。
 * N4：lastTodayStr 唔喺度改——resyncWhenIdle 內 loadAll 成功後先更新，
 * 失敗保留舊值俾下一個 tick／下次 focus 再試。
 */
async function resyncNow(): Promise<void> {
  if (client === null || resyncing) return
  if (store.getState().view !== 'ready') return
  resyncing = true
  try {
    await resyncWhenIdle()
  } catch (error) {
    console.warn('[resync] 失敗，保留舊畫面', error)
  } finally {
    resyncing = false
  }
}

/** M3：頁面重新可見／窗口重新聚焦時 resync（ready 狀態先會做嘢）。 */
function wireClockResync(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resyncNow()
  })
  window.addEventListener('focus', () => void resyncNow())
}

// ---------------------------------------------------------------------------
// m6 —— in-flight 樂觀寫入期間延後 resync
// ---------------------------------------------------------------------------

/**
 * resync（全量 reload）唔可以同 in-flight 樂觀寫入賽跑：若 reload 嘅 read 早過
 * 某個 write commit，而 realtime echo 又早過 reload response 到，reload 會用舊
 * 資料覆蓋已合併嘅新值。pendingWrites > 0 時改為記低請求，等計數歸零
 * （withPendingWrite finally）先真正 resync。
 *
 * N2：若最舊嘅寫入已 pending 超過 15 秒（疑似請求卡死，永遠唔會 resolve），
 * 唔可以永久鎖死 resync——照樣執行，並 console.warn 提示。賽跑風險由
 * realtime echo merge 同 loadAll 嘅 N1 計數檢查補返。
 * N9：判斷邏輯抽到 lib/resync.shouldResyncNow（純函式，有單元測試）。
 *
 * N4：回傳 true = 新資料已套用（並喺度前進 lastTodayStr）；false = 失敗或
 * 延後——lastTodayStr 保留舊值，跨日 resync 下一個 tick 會再試。
 */
async function resyncWhenIdle(): Promise<boolean> {
  if (!shouldResyncNow(pendingWrites, oldestPendingWriteAt, Date.now(), RESYNC_STALE_PENDING_MS)) {
    resyncDeferred = true
    return false
  }
  if (pendingWrites > 0) {
    console.warn(
      `[resync] 有寫入 pending 超過 ${RESYNC_STALE_PENDING_MS / 1000} 秒（疑似卡死），照樣 resync`,
    )
  }
  const ok = await loadAll('resync')
  // N4：跨日／重連 resync **成功**先至前進 lastTodayStr——失敗保留舊值，
  // 下一個 60s tick 見到日期仍然唔夾會自動再試（原本 tick 先改，失敗後成日
  // 都唔會重試，新一日嘅事件／循環日長期缺失）。
  if (ok) lastTodayStr = hkTodayDateString()
  return ok
}

/** m6：包住每一個 in-flight 寫入（樂觀 patch／INSERT／批量 strip UPDATE）。 */
async function withPendingWrite<T>(write: () => Promise<T>): Promise<T> {
  pendingWrites += 1
  if (oldestPendingWriteAt === null) oldestPendingWriteAt = Date.now() // N2
  try {
    return await write()
  } finally {
    pendingWrites -= 1
    if (pendingWrites === 0) oldestPendingWriteAt = null // N2
    if (pendingWrites === 0 && resyncDeferred) {
      resyncDeferred = false
      // N2：唔直接 loadAll——經 resyncWhenIdle 再檢查一次 pendingWrites
      // （call 嗰刻若有新寫入開始就延後），唔重演 m6 競爭。
      void resyncWhenIdle().catch((error) =>
        console.warn('[resync] 歸零後 resync 失敗，保留舊畫面', error),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Render pipeline（含焦點保全）
// ---------------------------------------------------------------------------

let renderQueued = false

/** 同 tick 多次 setState 合併做一次 render；IME 組字期間 defer（m8）。 */
function scheduleRender(): void {
  if (composing) {
    // m8：組字中重繪會斷字／走候選窗——pending flag，compositionend／blur 先 flush
    compositionRenderPending = true
    return
  }
  if (renderQueued) return
  renderQueued = true
  queueMicrotask(() => {
    renderQueued = false
    render()
  })
}

function render(): void {
  const state = store.getState()
  const focus = captureFocus()
  const drafts = captureDrafts()
  switch (state.view) {
    case 'loading':
      app.innerHTML = SKELETON_HTML
      break
    case 'login':
      app.innerHTML = loginMarkup(state.errorMsg)
      break
    case 'blocked':
      app.innerHTML = blockedMarkup()
      break
    case 'error':
      app.innerHTML = errorMarkup(state.errorMsg)
      break
    case 'ready':
      app.innerHTML = readyMarkup(state)
      break
  }
  restoreDrafts(drafts)
  restoreFocus(focus)
  focusNewTagInputIfNeeded()
  autosizeAllNotes()
}

// --- 焦點保全 ---------------------------------------------------------------

interface FocusSnapshot {
  selector: string
  start: number | null
  end: number | null
  /** 只喺「真係 dirty」（用戶手打、state 冇變過）時先有值；restore 時唔覆蓋 state 值。 */
  draft: string | null
}

/** M2：任務欄位對應嘅 store state 值（未知 field／行唔喺度 → null）。 */
function taskFieldStateValue(taskId: string, field: string): string | null {
  const task = store.getState().tasks.find((t) => t.id === taskId)
  if (task === undefined) return null
  switch (field) {
    case 'title':
      return task.title
    case 'notes':
      return task.notes
    case 'due_date':
      return task.due_date ?? ''
    case 'priority':
      return task.priority
    case 'category':
      return task.category
    default:
      return null
  }
}

/**
 * render 前捕捉焦點中嘅可編輯元素：
 * - 新增任務 / tag / 目錄輸入框 → 用 id 做 selector
 * - 任務欄位 → `[data-task-id][data-field]` 做 selector
 * 連 caret 同未 commit 草稿一齊影低，render 後原樣還原。
 *
 * M2：草稿只保留「真係 dirty」值。baseline（fieldBaseline）記上次 capture 見到
 * 嘅 state 欄位值：`el.value ≠ state`（用戶手打過）**且** `state == baseline`
 * （state 由上次 capture 以嚟冇變——rollback／遠端更新都會令 state 偏離
 * baseline）先至算 dirty。否則 draft 出 null——restore 唔覆蓋：
 * rollback 後唔會將失敗值寫返上 DOM，另一部裝置嘅新值亦唔會被本地舊值蓋走。
 */
function captureFocus(): FocusSnapshot | null {
  const el = document.activeElement
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLSelectElement)
  ) {
    return null
  }
  if (!app.contains(el)) return null
  const isText = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  const start = isText ? el.selectionStart : null
  const end = isText ? el.selectionEnd : null
  if (el.id === 'new-task-input' || el.id === 'new-tag-input' || el.id === 'manage-tag-input') {
    return { selector: `#${el.id}`, start, end, draft: isText ? el.value : null }
  }
  const field = el.dataset.field
  const taskId = el.dataset.taskId
  if (field !== undefined && taskId !== undefined) {
    // NIT1：CSS.escape 做 selector escape，唔係 esc()（HTML entity）——語意正確
    const selector = `[data-task-id="${CSS.escape(taskId)}"][data-field="${field}"]`
    let draft: string | null = null
    if (isText) {
      const stateValue = taskFieldStateValue(taskId, field)
      if (stateValue !== null) {
        const key = `${taskId}/${field}`
        const baseline = fieldBaseline.get(key) ?? stateValue
        fieldBaseline.set(key, stateValue) // baseline ← 上次見到嘅 state 值
        // N9：dirty 判斷抽到 lib/draft.isDraftDirty（純函式，有單元測試）
        draft = isDraftDirty(el.value, stateValue, baseline) ? el.value : null
      }
    }
    return { selector, start, end, draft }
  }
  return null
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (snapshot === null) return
  const el = app.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    snapshot.selector,
  )
  if (el === null) return // 行已收起／元素已移除——唔勉強
  if (snapshot.draft !== null && el.value !== snapshot.draft) {
    el.value = snapshot.draft // 打字中草稿優先；blur 時 dirty commit 先至寫入 DB
  }
  el.focus({ preventScroll: true })
  if (
    snapshot.start !== null &&
    snapshot.end !== null &&
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
  ) {
    try {
      el.setSelectionRange(snapshot.start, snapshot.end)
    } catch {
      // date 等特殊 input 不支援 selection——忽略
    }
  }
}

const DRAFT_IDS = ['new-task-input', 'new-tag-input', 'manage-tag-input'] as const

/** 非焦點中但已有文字嘅輸入框草稿（例如打咗「新增任務」標題未提交時 realtime 更新）。 */
function captureDrafts(): Map<string, string> {
  const drafts = new Map<string, string>()
  for (const id of DRAFT_IDS) {
    const el = document.getElementById(id)
    if (el instanceof HTMLInputElement && el.value !== '') drafts.set(id, el.value)
  }
  return drafts
}

function restoreDrafts(drafts: Map<string, string>): void {
  for (const id of DRAFT_IDS) {
    if (skipDraftRestore.has(id)) {
      skipDraftRestore.delete(id) // 啱啱成功清空——唔還原
      continue
    }
    const draft = drafts.get(id)
    if (draft === undefined) continue
    const el = document.getElementById(id)
    if (!(el instanceof HTMLInputElement)) continue
    if (el.value === '' && draft !== '' && document.activeElement !== el) el.value = draft
  }
}

function focusNewTagInputIfNeeded(): void {
  if (!focusTagInputOnce) return
  focusTagInputOnce = false
  const el = document.getElementById('new-tag-input')
  if (el instanceof HTMLInputElement) el.focus({ preventScroll: true })
}

// --- 標記組裝 ---------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 所有插值（用戶資料：title/notes/tag 名）都經呢度——防 XSS。 */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

function loginMarkup(errorMsg: string | null): string {
  return `
    <main class="center">
      <section class="panel">
        <h1>任務儀表板</h1>
        <p class="muted">以 Google 帳戶登入以繼續</p>
        ${errorMsg === null ? '' : `<p class="notice">⚠️ ${esc(errorMsg)}</p>`}
        <button type="button" class="btn" data-action="login">使用 Google 登入</button>
      </section>
    </main>`
}

function blockedMarkup(): string {
  return `
    <main class="center">
      <section class="panel">
        <h1>無法存取</h1>
        <p class="muted">此儀表板只供指定帳戶使用。</p>
        <button type="button" class="btn" data-action="other-account">改用其他帳戶</button>
      </section>
    </main>`
}

function errorMarkup(errorMsg: string | null): string {
  return `
    <main class="center">
      <section class="panel">
        <h1>載入失敗</h1>
        <p class="muted">請檢查網絡連線</p>
        ${errorMsg === null ? '' : `<p class="error-detail">${esc(errorMsg)}</p>`}
        <button type="button" class="btn" data-action="retry">重試</button>
      </section>
    </main>`
}

/** env 缺失等 boot 期錯誤——唔經 store（嗰陣連 client 都未有）。 */
function renderFatal(message: string): void {
  app.innerHTML = `
    <main class="center">
      <section class="panel">
        <h1>無法啟動</h1>
        <p class="muted">${esc(message)}</p>
        <button type="button" class="btn" data-action="reload">重新載入</button>
      </section>
    </main>`
}

function readyMarkup(state: AppState): string {
  const now = Date.now()
  const todayStr = hkTodayDateString(now)
  const warnings = syncWarnings(state.meta, now)
  // realtime merge 冇做 clone 過濾——render 層再過一次（冪等，O(n)）
  const groups = groupEvents(filterClones(state.events), now)
  const expandedId = state.tasks.some((task) => task.id === state.expandedTaskId)
    ? state.expandedTaskId
    : null
  return `
    <main class="layout">
      ${
        warnings.length === 0
          ? ''
          : `<div class="warning-bar" role="alert">${warnings
              .map((warning) => `<p>${esc(warning.text)}</p>`)
              .join('')}</div>`
      }
      <header class="topbar">
        <h1>任務儀表板</h1>
        <span class="today">${esc(formatGroupTitle('今日', todayStr))}</span>
        ${
          state.cycleToday === null
            ? '' // 假期無循環日記錄 → 唔顯示，唔報錯
            : `<span class="cycle">今日 Day ${esc(state.cycleToday.day_label)}</span>`
        }
      </header>
      <div class="columns">
        <section class="panel">
          <div class="panel-head">
            <h2>任務</h2>
            <button type="button" class="btn ghost small" data-action="manage-tags">管理標籤</button>
          </div>
          ${state.manageOpen ? managePanelMarkup(state) : ''}
          <div class="add-row">
            <input id="new-task-input" type="text" placeholder="新增任務——只填標題" autocomplete="off" />
            <button type="button" class="btn" data-action="add-task">新增</button>
          </div>
          <ul class="task-list">
            ${
              sortTasks(state.tasks)
                .map((task) => taskRowMarkup(task, state, expandedId))
                .join('') || '<li class="empty">暫無任務</li>'
            }
          </ul>
        </section>
        <section class="panel">
          <h2>事件</h2>
          <div class="event-group">
            <h3 class="group-title">${esc(formatGroupTitle('今日', todayStr))}</h3>
            ${eventListMarkup(groups.today, now)}
          </div>
          <div class="event-group">
            <h3 class="group-title">${esc(formatGroupTitle('聽日', addDays(todayStr, 1)))}</h3>
            ${eventListMarkup(groups.tomorrow, now)}
          </div>
          <div class="event-group">
            <h3 class="group-title">Upcoming</h3>
            ${
              groups.upcoming.length === 0
                ? '<p class="empty">無事件</p>' // R3-2：照出標題＋「無事件」，唔隱藏區塊
                : groups.upcoming
                    .map(
                      (day) =>
                        `<h4 class="group-sub">${esc(day.label)}</h4>${eventListMarkup(day.events, now)}`,
                    )
                    .join('')
            }
          </div>
        </section>
      </div>
    </main>`
}

function taskRowMarkup(task: TaskRow, state: AppState, expandedId: string | null): string {
  const done = task.status === 'done'
  const expanded = expandedId === task.id
  const id = esc(task.id)
  return `
    <li class="task-row${done ? ' done' : ''}${expanded ? ' expanded' : ''}" data-task-id="${id}">
      <div class="task-main">
        <button type="button" class="check" data-action="toggle-done" data-task-id="${id}" aria-pressed="${done}" aria-label="${done ? '取消完成' : '標記完成'}">${done ? '✓' : ''}</button>
        <span class="task-title">${esc(task.title)}</span>
        <span class="task-meta">
          ${task.pinned ? '<span title="置頂">📌</span>' : ''}
          ${task.status === 'park' ? '<span class="badge park">暫緩</span>' : ''}
          ${task.due_date === null ? '' : `<span>${esc(formatDdMm(task.due_date))}</span>`}
          <span class="prio-${esc(task.priority)}">${esc(PRIORITY_ZH[task.priority] ?? task.priority)}</span>
        </span>
      </div>
      ${expanded ? taskDetailMarkup(task, state) : ''}
    </li>`
}

function taskDetailMarkup(task: TaskRow, state: AppState): string {
  const id = esc(task.id)
  const chips = orderTagsForTask(task.tags, state.tags, state.tagUsage)
  return `
    <div class="task-detail">
      <div class="field-row">
        <label class="field">標題
          <input type="text" data-field="title" data-task-id="${id}" value="${esc(task.title)}" autocomplete="off" />
        </label>
        <label class="field">到期日
          <input type="date" data-field="due_date" data-task-id="${id}" value="${task.due_date ?? ''}" />
        </label>
      </div>
      <label class="field">筆記
        <textarea class="notes" data-field="notes" data-task-id="${id}" rows="3">${esc(task.notes)}</textarea>
      </label>
      <div class="field-row">
        ${selectMarkup('priority', task.id, task.priority, PRIORITY_OPTIONS, '優先度')}
        ${selectMarkup('category', task.id, task.category, CATEGORY_OPTIONS, '分類')}
      </div>
      <div class="tag-row">
        ${
          chips
            .map(
              (chip) =>
                `<button type="button" class="tag-chip${chip.selected ? ' selected' : ''}" data-tag="${esc(chip.name)}" data-task-id="${id}">${esc(chip.name)}</button>`,
            )
            .join('')
        }
        <button type="button" class="tag-chip add" data-action="add-tag" data-task-id="${id}">＋ 新增</button>
        ${
          tagInputTaskId === task.id
            ? `<input id="new-tag-input" type="text" data-task-id="${id}" maxlength="40" placeholder="新標籤，Enter 確認" autocomplete="off" />`
            : ''
        }
      </div>
      <div class="detail-actions">
        <button type="button" class="btn danger-ghost" data-action="delete-task" data-task-id="${id}">刪除任務</button>
      </div>
    </div>`
}

function selectMarkup(
  field: string,
  taskId: string,
  value: string,
  options: Array<[string, string]>,
  label: string,
): string {
  const opts = options
    .map(([v, text]) => `<option value="${v}"${v === value ? ' selected' : ''}>${text}</option>`)
    .join('')
  return `<label class="field">${label}<select data-field="${field}" data-task-id="${esc(taskId)}">${opts}</select></label>`
}

function managePanelMarkup(state: AppState): string {
  const entries = [...state.tags].sort(
    (a, b) =>
      (state.tagUsage.get(b.name) ?? 0) - (state.tagUsage.get(a.name) ?? 0) ||
      a.name.localeCompare(b.name, 'zh-Hant'),
  )
  return `
    <div class="manage-panel">
      <div class="add-row">
        <input id="manage-tag-input" type="text" maxlength="40" placeholder="新增標籤到目錄" autocomplete="off" />
        <button type="button" class="btn" data-action="manage-add">新增</button>
      </div>
      <ul class="manage-list">
        ${
          entries.length === 0
            ? '<li class="empty">目錄尚無標籤</li>'
            : entries
                .map(
                  (tag) => `
          <li class="manage-row">
            <span class="manage-name">${esc(tag.name)}</span>
            <span class="manage-count">${state.tagUsage.get(tag.name) ?? 0}</span>
            <button type="button" class="btn ghost small" data-action="remove-tag" data-tag="${esc(tag.name)}">移除</button>
          </li>`,
                )
                .join('')
        }
      </ul>
    </div>`
}

function eventListMarkup(rows: readonly EventRow[], now: number): string {
  if (rows.length === 0) return '<p class="empty">無事件</p>'
  return `<ul class="event-list">${rows.map((row) => eventRowMarkup(row, now)).join('')}</ul>`
}

function eventRowMarkup(row: EventRow, now: number): string {
  const display = eventState(row, now)
  const icon = row.account_key === 'work' ? '💼' : '🏠' // 唔顯示 location
  const time = display.allDay
    ? '全日' // 全日永遠唔出 00:00
    : display.ongoing
      ? `進行中（至 ${formatHm(Date.parse(row.end_time))}）` // 跨日未結束
      : formatRange(Date.parse(row.start_time), Date.parse(row.end_time))
  return `
    <li class="event-row${display.past ? ' past' : ''}${display.allDay ? ' allday' : ''}">
      <span class="ev-icon" aria-hidden="true">${icon}</span>
      <span class="ev-time">${esc(time)}</span>
      <span class="ev-title">${esc(row.title)}</span>
    </li>`
}

// ---------------------------------------------------------------------------
// 事件委派
// ---------------------------------------------------------------------------

function wireDelegation(): void {
  app.addEventListener('pointerdown', onPointerDown)
  app.addEventListener('click', onClick)
  app.addEventListener('focusout', onFocusOut)
  app.addEventListener('focusin', onFocusIn)
  app.addEventListener('compositionstart', onCompositionStart)
  app.addEventListener('compositionend', onCompositionEnd)
  app.addEventListener('change', onChange)
  app.addEventListener('input', onInput)
  app.addEventListener('keydown', onKeyDown)
}

/** m8：IME 組字開始——期間 defer render（compositionend／blur 才 flush）。 */
function onCompositionStart(event: CompositionEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    composing = true
  }
}

/** m8：組字結束——解除 defer，flush 期間累積嘅 render。 */
function onCompositionEnd(event: CompositionEvent): void {
  if (
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    return
  }
  composing = false
  flushCompositionRender()
}

/** m8：compositionend／blur／pointerdown／keydown（N3）時 flush 期間累積嘅 render（composing 已 false → 正常排程）。 */
function flushCompositionRender(): void {
  if (!compositionRenderPending) return
  compositionRenderPending = false
  scheduleRender()
}

/** M2：focus 落任務欄位時記低當下 state 值做 baseline——冇打字嘅 draft 唔算 dirty。 */
function onFocusIn(event: FocusEvent): void {
  const el = event.target
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
  const field = el.dataset.field
  const taskId = el.dataset.taskId
  if (field === undefined || taskId === undefined || taskId === '') return
  const stateValue = taskFieldStateValue(taskId, field)
  if (stateValue !== null) fieldBaseline.set(`${taskId}/${field}`, stateValue)
}

/**
 * pointerdown（fire 喺任何焦點轉移之前）統一處理任務行／動作按鈕／tag chip：
 * 1. 先落實焦點中欄位（值仍在 DOM，唔會食走）
 * 2. preventDefault 防搶焦點 → 唔會中途 focusout/render → 唔會令 click 打中舊節點
 * 3. 即刻行動（suppress 之後同元素嘅 click）
 */
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return // 右鍵／中鍵唔觸發
  const target = event.target
  if (!(target instanceof Element)) return
  const actionEl = target.closest<HTMLElement>('[data-action]')
  const tagEl = actionEl === null ? target.closest<HTMLElement>('[data-tag]') : null
  const rowEl =
    actionEl === null && tagEl === null && target.closest('.task-detail') === null
      ? target.closest<HTMLElement>('.task-row')
      : null
  if (actionEl === null && tagEl === null && rowEl === null) return
  // N3：某啲 IME 路徑只 blur／唔出 compositionend（Safari 次序、切換 IME）——
  // pointerdown 視為組字已結束，先清 flag 再 flush，唔好令 composing 卡 true
  // 令 scheduleRender 之後永久 defer（畫面凍結）。
  composing = false
  flushCompositionRender()
  commitFocusedField()
  event.preventDefault()
  suppressedClick = actionEl ?? tagEl
  if (actionEl !== null) void runAction(actionEl)
  else if (tagEl !== null) void toggleTaskTag(tagEl)
  else if (rowEl !== null) toggleExpand(rowEl)
}

/** click 只服務鍵盤啟用（Enter/Space on button）；滑鼠路徑經 pointerdown 已處理。 */
function onClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const actionEl = target.closest<HTMLElement>('[data-action]')
  const el = actionEl ?? target.closest<HTMLElement>('[data-tag]')
  if (el === null) return
  if (el === suppressedClick) {
    suppressedClick = null
    return
  }
  suppressedClick = null
  commitFocusedField()
  if (actionEl !== null) void runAction(actionEl)
  else void toggleTaskTag(el)
}

function onFocusOut(event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  // N3：blur 時組字一定已結束或被放棄——先清 composing 再 flush。唔清嘅話
  // flushCompositionRender → scheduleRender 會喺 composing 檢查被擋返，
  // flush 救唔到，之後所有 render（時鐘／realtime／rollback）永久 defer。
  composing = false
  flushCompositionRender() // m8：blur 都要 flush deferred render
  if (target.id === 'new-tag-input') {
    if (!app.contains(target)) return // render 換走嘅舊節點——唔好再收一次
    tagInputTaskId = null // 開住嘅 tag 輸入框 blur 就收起
    scheduleRender()
    return
  }
  const field = target.dataset.field
  if (field === undefined) return
  const taskId = target.dataset.taskId
  if (taskId !== undefined && taskId !== '') {
    fieldBaseline.delete(`${taskId}/${field}`) // M2：離場清 baseline
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    // detached（render 換走）都照 commit——元素值仍可讀，dirty check 防重複
    commitField(target, field)
  }
}

/** select / date 揀完即存（change 喺 blur 前fire）。 */
function onChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  const field = target.dataset.field
  if (field === undefined) return
  commitField(target, field)
}

/** 筆記 textarea 自動高度（唔 commit——blur 先存）。 */
function onInput(event: Event): void {
  const target = event.target
  if (target instanceof HTMLTextAreaElement) autosize(target)
}

function onKeyDown(event: KeyboardEvent): void {
  // N3 保險：瀏覽器話組字已結束（isComposing === false）但我哋 flag 仲卡 true
  // （某啲 IME 路徑只 blur 唔出 compositionend）→ 就當組字已結束，解除 defer。
  // 真係組字中嘅 keydown 係 isComposing === true（Chrome keyCode 229），唔會誤清。
  if (composing && !event.isComposing) {
    composing = false
    flushCompositionRender()
  }
  if (event.key !== 'Enter' || event.isComposing) return // IME 組字中唔觸發
  if (event.repeat) return // M4：按住 Enter 嘅 OS key repeat 唔可以重複提交
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target.id === 'new-task-input') {
    event.preventDefault()
    void addTask()
  } else if (target.id === 'new-tag-input') {
    event.preventDefault()
    void addTagToTask(target.dataset.taskId ?? '')
  } else if (target.id === 'manage-tag-input') {
    event.preventDefault()
    void addCatalogTag()
  }
}

// ---------------------------------------------------------------------------
// 動作實作
// ---------------------------------------------------------------------------

async function runAction(el: HTMLElement): Promise<void> {
  switch (el.dataset.action) {
    case 'login': {
      if (client === null) return
      try {
        await signIn(client) // redirect 去 Google；失敗（網絡/redirect 白名單）就提示
      } catch (error) {
        console.warn('[auth] signIn 失敗', error)
        showToast('⚠️ 登入失敗，請重試')
      }
      break
    }
    case 'other-account':
      await signOutNow()
      break
    case 'retry':
      store.setState({ view: 'loading', errorMsg: null })
      // M1：重試行 enterReady()（同初次載入同一條路）——成功一樣會 ready + 訂閱
      // realtime + 開時鐘，而且會重跑 owner 閘。
      await enterReady()
      break
    case 'reload':
      location.reload()
      break
    case 'toggle-done':
      await toggleDone(el.dataset.taskId ?? '')
      break
    case 'add-task':
      await addTask()
      break
    case 'add-tag':
      tagInputTaskId = el.dataset.taskId ?? null
      focusTagInputOnce = tagInputTaskId !== null
      scheduleRender()
      break
    case 'manage-tags':
      store.setState({ manageOpen: !store.getState().manageOpen })
      break
    case 'manage-add':
      await addCatalogTag()
      break
    case 'remove-tag':
      await removeCatalogTag(el.dataset.tag ?? '')
      break
    case 'delete-task':
      await deleteTaskFlow(el.dataset.taskId ?? '')
      break
    default:
      break
  }
}

/** R3-1：done→todo、其餘（todo/park）→done；park 唔還原。 */
async function toggleDone(taskId: string): Promise<void> {
  const task = store.getState().tasks.find((t) => t.id === taskId)
  if (task === undefined) return
  // DB CHECK 保證 status ∈ {todo,done,park}；gen types 出 string，喺度收窄
  const nextStatus = toggleStatus(task.status as TaskStatus)
  // NIT5：本地樂觀補 completed_at（剔完成 → 本地 now；取消 → null），令 done 群
  // 排序同「今日完成」可見性即刻啱。DB 一直只送 status——completed_at 由
  // Phase 1 trigger 獨佔、client 冇 grant（見 api.ts）；realtime echo 會用
  // trigger 算出嘅正確值覆寫返。
  const patch: OptimisticTaskPatch =
    nextStatus === 'done'
      ? { status: nextStatus, completed_at: new Date().toISOString() }
      : { status: nextStatus, completed_at: null }
  await runOptimistic(taskId, patch, { status: nextStatus })
}

async function toggleTaskTag(el: HTMLElement): Promise<void> {
  const taskId = el.dataset.taskId
  const name = el.dataset.tag
  if (taskId === undefined || name === undefined || name === '') return
  const task = store.getState().tasks.find((t) => t.id === taskId)
  if (task === undefined) return
  await runOptimistic(taskId, { tags: toggleTagOnTask(task, name) })
}

/** 展開／收起（同時只得一行展開——store 只有一個 expandedTaskId）。 */
function toggleExpand(rowEl: HTMLElement): void {
  const id = rowEl.dataset.taskId
  if (id === undefined) return
  const current = store.getState().expandedTaskId
  const next = current === id ? null : id
  if (next !== current) tagInputTaskId = null
  store.setState({ expandedTaskId: next })
}

/**
 * 樂觀更新 + 失敗 rollback + 統一 toast（§4.4）。
 * patch（入本地 state）同 persistPatch（送 DB）可以唔同——NIT5 嘅 completed_at
 * 樂觀值只入本地，唔會送 DB（trigger 獨佔）。m6：整個寫入包喺 withPendingWrite
 * 入面，in-flight 期間 resync 會延後。
 * N7：failToast——失敗 toast 文案可以按實際中間態調整（例如 tag 已寫入目錄，
 * 唔存在「還原」一說），預設維持「已還原」。
 */
async function runOptimistic(
  taskId: string,
  patch: OptimisticTaskPatch,
  persistPatch: TaskPatch = patch,
  failToast: string = ROLLBACK_TOAST,
): Promise<boolean> {
  const c = client
  if (c === null) return false
  const success = await withPendingWrite(() =>
    optimisticUpdate(store, taskId, patch, (p) => updateTask(c, taskId, p), persistPatch),
  )
  if (!success) showToast(failToast)
  return success
}

/** 讀焦點中嘅 [data-field] 元素並落實 dirty commit（pointerdown/click 行動前調用）。 */
function commitFocusedField(): void {
  const el = document.activeElement
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLSelectElement)
  ) {
    return
  }
  const field = el.dataset.field
  if (field !== undefined) commitField(el, field)
}

/**
 * 離開欄位 dirty 檢查 → optimistic update（§4.4：值無變就唔發 UPDATE，避免 realtime 噪音）。
 * patch 一律經 api.updateTask（九欄白名單執行期把關）。
 */
function commitField(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  field: string,
): void {
  const taskId = el.dataset.taskId
  if (taskId === undefined || taskId === '') return
  const task = store.getState().tasks.find((t) => t.id === taskId)
  if (task === undefined) return
  let patch: TaskPatch | null = null
  let revert = false
  switch (field) {
    case 'title': {
      const value = el.value.trim()
      if (value === '') revert = true // 空 title 唔送 DB（CHECK 會拒）——重繪還原
      else if (value !== task.title) patch = { title: value }
      break
    }
    case 'notes':
      if (el.value !== task.notes) patch = { notes: el.value } // 原樣儲存，唔做 markdown 處理
      break
    case 'due_date': {
      const next = el.value === '' ? null : el.value
      if (next !== task.due_date) patch = { due_date: next }
      break
    }
    case 'priority':
      if (el.value !== task.priority) patch = { priority: el.value }
      break
    case 'category':
      if (el.value !== task.category) patch = { category: el.value }
      break
    default:
      revert = true
  }
  if (patch !== null) {
    void runOptimistic(taskId, patch)
    return
  }
  if (revert) scheduleRender() // 顯示值同 state 唔一致（例如清空 title）→ 重繪還原
}

/** M4：in-flight 期間 disable 對應動作按鈕（render 重建後會復原，guard 仲喺度）。 */
function setActionBusy(action: string, busy: boolean): void {
  const btn = app.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  if (btn !== null) btn.disabled = busy
}

/** 新增任務：只送 title，成功先插入 state（避免 temp id 同 realtime INSERT 撞）。 */
async function addTask(): Promise<void> {
  const c = client
  if (c === null || addingTask) return // M4：in-flight guard
  const input = document.getElementById('new-task-input')
  if (!(input instanceof HTMLInputElement)) return
  const title = input.value.trim()
  if (title === '') {
    input.focus()
    return
  }
  addingTask = true
  setActionBusy('add-task', true)
  try {
    const row = await withPendingWrite(() => insertTask(c, { title }))
    mergeTask(store, row)
    skipDraftRestore.add('new-task-input')
    input.value = ''
  } catch (error) {
    console.warn('[addTask] 失敗', error)
    showToast(INSERT_FAILED_TOAST) // m2：INSERT 前失敗——乜都冇寫，唔好話「已還原」
  } finally {
    addingTask = false
    setActionBusy('add-task', false)
  }
}

/** 展開區「＋ 新增」：驗證 → insertTag → 選取到當前任務 → 收起輸入框。 */
async function addTagToTask(taskId: string): Promise<void> {
  const c = client
  if (c === null || taskId === '') return
  const input = document.getElementById('new-tag-input')
  if (!(input instanceof HTMLInputElement)) return
  const error = validateTagName(input.value)
  if (error !== null) {
    showToast(error) // 輸入框保留俾用戶改
    input.focus()
    return
  }
  const name = input.value.trim()
  let row: TagRow
  try {
    row = await withPendingWrite(() => insertTag(c, name))
  } catch (cause) {
    console.warn('[addTagToTask] 失敗', cause)
    showToast(INSERT_FAILED_TOAST) // m2：insert 失敗——目錄未加、任務未改
    return
  }
  mergeTag(store, row) // 本地即刻有（realtime INSERT 稍後 confirm，upsert 冪突）
  tagInputTaskId = null
  const task = store.getState().tasks.find((t) => t.id === taskId)
  if (task !== undefined && !task.tags.includes(name)) {
    // N7：insertTag 已成功——tag 已寫入 public.tags（design D2 接受嘅中間態），
    // 呢個失敗唔係「已還原」，用專屬文案講清楚。
    await runOptimistic(
      taskId,
      { tags: toggleTagOnTask(task, name) }, // 即時選取
      undefined, // persistPatch 用預設（= patch）
      TAG_CATALOG_ONLY_TOAST,
    )
  }
}

/** 目錄管理面板「＋ 新增」：同一條 validateTagName 路徑；重複唔報錯。 */
async function addCatalogTag(): Promise<void> {
  const c = client
  if (c === null || addingCatalogTag) return // M4：in-flight guard
  const input = document.getElementById('manage-tag-input')
  if (!(input instanceof HTMLInputElement)) return
  const error = validateTagName(input.value)
  if (error !== null) {
    showToast(error)
    input.focus()
    return
  }
  const name = input.value.trim()
  addingCatalogTag = true
  setActionBusy('manage-add', true)
  try {
    const row = await withPendingWrite(() => insertTag(c, name))
    mergeTag(store, row)
    skipDraftRestore.add('manage-tag-input')
    input.value = ''
  } catch (cause) {
    console.warn('[addCatalogTag] 失敗', cause)
    showToast(INSERT_FAILED_TOAST) // m2
  } finally {
    addingCatalogTag = false
    setActionBusy('manage-add', false)
  }
}

/**
 * 移除目錄 tag（§4.5，R1-4）：
 * 撈使用中行（含軟刪）→ 使用中 > 0 彈確認（顯示影響數）→ stripTag 逐行 update
 * （visible 行行樂觀更新、失敗還原；軟刪行直接 UPDATE）→ 全部成功先刪目錄行。
 * 順序刻意「先 tasks 後目錄」：中途失敗最多剩「目錄有、任務已清」（design D2 接受）。
 */
async function removeCatalogTag(name: string): Promise<void> {
  const c = client
  if (c === null || name === '') return
  let rows: Array<Pick<TaskRow, 'id' | 'tags' | 'deleted_at'>>
  try {
    rows = await fetchTaskRowsWithTag(c, name)
  } catch (cause) {
    console.warn('[removeCatalogTag] 撈行失敗', cause)
    showToast(ACTION_FAILED_TOAST) // m2：未寫任何嘢——唔係「已還原」
    return
  }
  const affected = rows.filter((row) => row.deleted_at === null).length // R1-5 口徑
  if (affected > 0) {
    const confirmed = await confirmDialog(
      `此標籤正被 ${affected} 個任務使用，確認從所有任務移除並刪除目錄項目？`,
    )
    if (!confirmed) return // 取消 → 完全不變
  }
  let strippedAny = false // N7：一行都未成功更新過 → 失敗唔係「部分已更新」
  for (const update of stripTag(rows, name)) {
    if (store.getState().tasks.some((task) => task.id === update.id)) {
      const success = await runOptimistic(update.id, { tags: update.tags })
      if (!success) {
        // m2/N7：前面行已寫入 DB →「部分已更新」；第一行就失敗 → 乜都冇更新過，
        // 話「部分已更新」會誤導，用「移除失敗」。（runOptimistic 先講咗 rollback
        // toast，呢句覆寫做事實。）
        showToast(strippedAny ? TAG_PARTIAL_REMOVE_TOAST : TAG_REMOVE_FAILED_TOAST)
        return // 任一失敗 → 中止（目錄行唔刪）
      }
      strippedAny = true
    } else {
      try {
        // 軟刪行不在 store——直接 UPDATE（m6：包住 pending 寫入）
        await withPendingWrite(() => updateTaskTags(c, update.id, update.tags))
      } catch (cause) {
        console.warn('[removeCatalogTag] strip 失敗', cause)
        showToast(strippedAny ? TAG_PARTIAL_REMOVE_TOAST : TAG_REMOVE_FAILED_TOAST) // m2/N7
        return
      }
      strippedAny = true
    }
  }
  try {
    await withPendingWrite(() => deleteTag(c, name))
  } catch (cause) {
    console.warn('[removeCatalogTag] deleteTag 失敗', cause)
    showToast(TAG_PARTIAL_REMOVE_TOAST) // m2：任務已全部 strip，但目錄未刪
    return
  }
  store.setState({ tags: store.getState().tags.filter((tag) => tag.name !== name) }) // 本地即刻收
}

/** R3-3 刪除任務兩步確認：展開區按鈕 → <dialog> → 確認先 UPDATE deleted_at（唔發 DELETE）。 */
async function deleteTaskFlow(taskId: string): Promise<void> {
  if (taskId === '' || !store.getState().tasks.some((task) => task.id === taskId)) return
  const confirmed = await confirmDialog(DELETE_CONFIRM_TEXT)
  if (!confirmed) return // 取消／Esc／click outside → 任務不變
  await runOptimistic(taskId, { deleted_at: new Date().toISOString() })
}

/** 共用兩步確認對話框（刪除任務／移除使用中 tag）。回 true = 確認。 */
function confirmDialog(text: string): Promise<boolean> {
  if (dialogEl.open) return Promise.resolve(false) // 防重入
  dialogTextEl.textContent = text
  dialogEl.returnValue = ''
  dialogEl.showModal()
  return new Promise((resolve) => {
    dialogEl.addEventListener(
      'close',
      () => resolve(dialogEl.returnValue === 'ok'), // Esc / cancel 一律 false
      { once: true },
    )
  })
}

function showToast(text: string, ms = 3000): void {
  toastEl.textContent = text
  toastEl.hidden = false
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.hidden = true
  }, ms)
}

// ---------------------------------------------------------------------------
// textarea 自動高度
// ---------------------------------------------------------------------------

function autosizeAllNotes(): void {
  for (const el of app.querySelectorAll<HTMLTextAreaElement>('textarea.notes')) autosize(el)
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

boot()
