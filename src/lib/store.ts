/**
 * 狀態層 —— AppState + createStore（getState / setState / subscribe）+
 * 樂觀更新（snapshot → apply → rollback，§4.4）+ realtime merge 用嘅
 * upsertByKey / removeByKey 小函式。唔碰 DOM、唔碰 supabase。
 * 寫入失敗嘅 toast 由 main.ts 負責：optimisticUpdate 只回 boolean。
 */
import type { TaskPatch } from './api'
import { isVisibleTask } from './taskQuery'
import type { AppView, CycleDayRow, EventRow, SystemMetaRow, TagRow, TaskRow } from './types'

/** 全域 app 狀態（§4.1）。tasks 係可見任務（載入時同 realtime merge 都過 isVisibleTask）。 */
export interface AppState {
  view: AppView
  errorMsg: string | null
  tasks: TaskRow[]
  /** 全部非軟刪任務嘅 tag 使用次數（R1-5 口徑，key = tag 名）。 */
  tagUsage: Map<string, number>
  tags: TagRow[]
  /** 事件窗口內原始行（clone 已濾；cancelled 由 render 層過濾，un-cancel 可還原）。 */
  events: EventRow[]
  meta: SystemMetaRow[]
  cycleToday: CycleDayRow | null
  expandedTaskId: string | null
  manageOpen: boolean
  /** realtime channel 連住冇（斷線變 false，重連 SUBSCRIBED 變 true）。 */
  connected: boolean
}

export function createInitialState(): AppState {
  return {
    view: 'loading',
    errorMsg: null,
    tasks: [],
    tagUsage: new Map(),
    tags: [],
    events: [],
    meta: [],
    cycleToday: null,
    expandedTaskId: null,
    manageOpen: false,
    connected: false,
  }
}

export type StateListener = (state: AppState) => void

export interface Store {
  getState(): AppState
  /** 淺合併 patch 並通知 listeners（通知期間 unsubscribe 都安全：迭代副本）。 */
  setState(patch: Partial<AppState>): void
  /** 回 unsubscribe 函式。 */
  subscribe(listener: StateListener): () => void
}

export function createStore(initial: AppState = createInitialState()): Store {
  let state = initial
  const listeners = new Set<StateListener>()
  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 樂觀更新（§4.4）
// ---------------------------------------------------------------------------

/**
 * 樂觀本地 patch 型別：TaskPatch 之外可以多帶 `completed_at`（NIT5：剔完成時用
 * 本地 now 即時得到啱嘅排序／顯示）。`completed_at` 由 DB trigger 獨佔、client
 * 冇 update grant——呢個值**只入本地 state**；persist 一律用 persistPatch，
 * realtime echo 會用 trigger 算出嘅正確值覆寫返。
 */
export type OptimisticTaskPatch = TaskPatch & { completed_at?: TaskRow['completed_at'] }

/**
 * 樂觀更新一個任務：
 * 1. snapshot 該行（淺拷貝夠——patch 欄位都係 scalar / 陣列替換，唔 in-place mutate）
 * 2. setState 即時套用 patch → render（即時反饋）；patch 帶 `deleted_at`（soft delete）
 *    就即刻由可見列表移除該行
 * 3. await persist(persistPatch)（一般 = api.updateTask）
 *    - 成功 → 回 true（realtime UPDATE 回同一行，merge upsert 冇冲突）
 *    - 失敗 → 回 false（toast 由 main.ts 顯示），並還原：
 *      - m7：**只還原 patch 涉及嘅 key**（spec「該欄位還原」），唔好還原整行——
 *        同一任務之後成功嘅其他欄位修改唔會被一齊沖走
 *      - 行已唔喺列表（realtime merge 移走）→ 照舊還原返成個 patch 前快照
 *        （佢 patch 前喺度）；下一次 merge / resync 自會修正
 */
export async function optimisticUpdate(
  store: Store,
  id: string,
  patch: OptimisticTaskPatch,
  persist: (patch: TaskPatch) => Promise<unknown>,
  /** NIT5：真正送 DB 嘅 patch；預設同 patch 一樣（本地多帶嘅 completed_at 唔會送）。 */
  persistPatch: TaskPatch = patch,
): Promise<boolean> {
  const state = store.getState()
  const before = state.tasks.find((task) => task.id === id)
  if (before === undefined) return false
  const snapshot: TaskRow = { ...before }
  const softDelete = patch.deleted_at !== undefined && patch.deleted_at !== null
  store.setState({
    tasks: softDelete
      ? state.tasks.filter((task) => task.id !== id)
      : state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
  })
  try {
    await persist(persistPatch)
    return true
  } catch {
    const tasks = store.getState().tasks
    const current = tasks.find((task) => task.id === id)
    if (current === undefined) {
      store.setState({ tasks: [...tasks, snapshot] })
      return false
    }
    const restored: TaskRow = { ...current }
    const beforeRecord = before as unknown as Record<string, unknown>
    const restoredRecord = restored as unknown as Record<string, unknown>
    for (const key of Object.keys(patch)) {
      restoredRecord[key] = beforeRecord[key]
    }
    store.setState({
      tasks: tasks.map((task) => (task.id === id ? restored : task)),
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// realtime merge helpers（§4.7）
// ---------------------------------------------------------------------------

/** 按 key upsert（回新陣列，唔 mutate 輸入）。 */
export function upsertByKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  incoming: T,
): T[] {
  const incomingKey = keyOf(incoming)
  const exists = rows.some((row) => keyOf(row) === incomingKey)
  return exists
    ? rows.map((row) => (keyOf(row) === incomingKey ? incoming : row))
    : [...rows, incoming]
}

/** 按 key 移除（回新陣列；key 唔存在就原樣回）。 */
export function removeByKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  key: string,
): T[] {
  return rows.filter((row) => keyOf(row) !== key)
}

/**
 * realtime merge 嘅任務收發點：可見（isVisibleTask 過）→ upsert；唔可見
 * （軟刪／舊 done）→ 由列表移除。initial query 同 merge 共用同一條可見性判斷。
 */
export function mergeTask(store: Store, row: TaskRow): void {
  const tasks = store.getState().tasks
  if (isVisibleTask(row, Date.now())) {
    store.setState({ tasks: upsertByKey(tasks, (t) => t.id, row) })
  } else {
    store.setState({ tasks: removeByKey(tasks, (t) => t.id, row.id) })
  }
}

/** 事件 merge（upsert by id）——窗口內外判斷同 cancelled 處理喺 realtime.ts。 */
export function mergeEvent(store: Store, row: EventRow): void {
  store.setState({ events: upsertByKey(store.getState().events, (e) => e.id, row) })
}

/** system_meta merge（upsert by key）。 */
export function mergeMeta(store: Store, row: SystemMetaRow): void {
  store.setState({ meta: upsertByKey(store.getState().meta, (m) => m.key, row) })
}

/** tag 目錄 merge（upsert by name）。 */
export function mergeTag(store: Store, row: TagRow): void {
  store.setState({ tags: upsertByKey(store.getState().tags, (t) => t.name, row) })
}

/** cycle_days merge：只採用今日；其他日期忽略（state 只存 cycleToday 一格）。 */
export function mergeCycleDay(store: Store, row: CycleDayRow, todayStr: string): void {
  if (row.date !== todayStr) return
  store.setState({ cycleToday: row })
}
