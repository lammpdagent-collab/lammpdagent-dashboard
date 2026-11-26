/**
 * Realtime（§4.7）—— 單一 channel `dashboard-realtime` 訂閱五張表
 * （tasks / events / system_meta / tags / cycle_days）嘅 postgres_changes。
 *
 * Merge 規則（全部 upsert / remove by PK，然後由 store listeners render）：
 * - tasks：INSERT/UPDATE 過 isVisibleTask → upsert 或移除；並 debounce 500ms
 *   重跑 tag usage 細查詢（R1-5，含舊 done 任務）。DELETE 正常唔會出現
 *   （tasks 冇 DELETE grant），一律 remove by id 防禦。
 * - events：INSERT/UPDATE upsert by id；新 start_time 已出窗口 → remove；
 *   cancelled_at 交由 render 層過濾（un-cancel 可還原）。DELETE → remove。
 * - system_meta：upsert by key。
 * - tags：INSERT upsert by name；DELETE remove（選取中 chips 仍按 task.tags 顯示，D2）。
 * - cycle_days：只有 date === 今日先採用；DELETE 今日 → cycleToday = null。
 *
 * 重連狀態機（風險 #3）：斷線（CHANNEL_ERROR / TIMED_OUT / CLOSED）→ connected=false、
 * everLost=true；重連 SUBSCRIBED → connected=true、everLost=true 時 debounce 3s
 * 靜默全量 reload（背景刷新，唔閃骨架屏）。supabase-js 內建 rejoin backoff，
 * 唔自己寫 retry loop。另加 window 'online' listener 觸發一次 resync；
 * resync 失敗 → console.warn + 保持舊畫面，等下次事件／重連再試。
 */
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from '@supabase/supabase-js'
import { buildEventWindow } from './eventQuery'
import { hkTodayDateString } from './time'
import {
  mergeCycleDay,
  mergeEvent,
  mergeMeta,
  mergeTag,
  mergeTask,
  removeByKey,
  type Store,
} from './store'
import type { CycleDayRow, EventRow, SystemMetaRow, TagRow, TaskRow } from './types'

const CHANNEL_NAME = 'dashboard-realtime'

/** 重連成功後全量 reload 嘅 debounce（§4.7：3 秒）。 */
const RELOAD_DEBOUNCE_MS = 3000

/** tasks 變更後 tag usage 重算嘅 debounce（§4.5：500ms）。 */
const USAGE_REFRESH_DEBOUNCE_MS = 500

export interface RealtimeDeps {
  /**
   * 全量重載（main.ts 嘅 loadAll：Promise.allSettled 六個 fetch）。
   * 重連後靜默刷新用——實作必須唔閃骨架屏（背景更新 state）。
   */
  reload: () => void | Promise<void>
  /** 重算 tag usage（api.fetchTaskTagRows → tagUsageCounts → setState）。本模組負責 debounce。 */
  refreshTagUsage: () => void | Promise<void>
}

export interface RealtimeHandle {
  channel: RealtimeChannel
  /**
   * N1：postgres_changes 回呼嘅單調計數（subscribe 以嚟，唔重設）。
   * loadAll 前後讀數對比：load 期間有 event 闖入 → 該 event 可能喺 setState 前
   * 被較舊嘅讀取結果覆蓋 → 要再排一次 resync 補返。
   */
  changeCount(): number
  /** 登出／blocked 時拆訂閱（§4.7：零訂閱）；同時清走 debounce timer 同 online listener。 */
  unsubscribe: () => Promise<void>
}

/** 遠端行已出事件窗口（end ≤ 今日00:00 或 start ≥ 今日+7日00:00）→ merge 時唔留。 */
function isOutOfWindow(row: EventRow): boolean {
  const window = buildEventWindow(Date.now()) // 事件當下重算——跨午夜自動跟新窗口
  const end = Date.parse(row.end_time)
  const start = Date.parse(row.start_time)
  return end <= Date.parse(window.startIso) || start >= Date.parse(window.endIso)
}

type Timer = ReturnType<typeof setTimeout>

/**
 * 建立五表訂閱。合併只掂 store；DOM 同 toast 都唔碰。
 * deps.reload / deps.refreshTagUsage 由 main.ts 提供實作。
 */
export function subscribeRealtime(
  client: SupabaseClient,
  store: Store,
  deps: RealtimeDeps,
): RealtimeHandle {
  let everLost = false
  let reloadTimer: Timer | null = null
  let usageTimer: Timer | null = null
  // N1：postgres_changes 回呼單調計數（每次任何一表回呼 +1）——畀 loadAll 對比
  // load 前後讀數，偵測 load 期間闖入、可能被整批 setState 覆蓋嘅 event。
  let changeCount = 0

  const clearTimer = (timer: Timer | null): Timer | null => {
    if (timer !== null) clearTimeout(timer)
    return null
  }

  /** debounce 後靜默全量 reload；失敗只 warn，保持舊畫面（spec 未定義 resync 失敗 UI）。 */
  const scheduleReload = (): void => {
    reloadTimer = clearTimer(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void Promise.resolve(deps.reload()).catch((error) => {
        console.warn('[realtime] 重連後全量重載失敗，保留舊畫面', error)
      })
    }, RELOAD_DEBOUNCE_MS)
  }

  /** tasks 事件 → debounce 500ms 重跑 tag usage 細查詢（§4.5）。 */
  const scheduleUsageRefresh = (): void => {
    usageTimer = clearTimer(usageTimer)
    usageTimer = setTimeout(() => {
      usageTimer = null
      void Promise.resolve(deps.refreshTagUsage()).catch((error) => {
        console.warn('[realtime] tag usage 重算失敗', error)
      })
    }, USAGE_REFRESH_DEBOUNCE_MS)
  }

  const onTask = (payload: RealtimePostgresChangesPayload<TaskRow>): void => {
    changeCount += 1 // N1
    if (payload.eventType === 'DELETE') {
      const id = payload.old.id
      if (id !== undefined) {
        store.setState({ tasks: removeByKey(store.getState().tasks, (t) => t.id, id) })
      }
      return
    }
    mergeTask(store, payload.new) // isVisibleTask 過濾 + upsert/remove 喺入面
    scheduleUsageRefresh()
  }

  const onEvent = (payload: RealtimePostgresChangesPayload<EventRow>): void => {
    changeCount += 1 // N1
    if (payload.eventType === 'DELETE') {
      const id = payload.old.id
      if (id !== undefined) {
        store.setState({ events: removeByKey(store.getState().events, (e) => e.id, id) })
      }
      return
    }
    const row = payload.new
    if (isOutOfWindow(row)) {
      store.setState({ events: removeByKey(store.getState().events, (e) => e.id, row.id) })
    } else {
      mergeEvent(store, row) // cancelled_at 交由 render 層過濾（un-cancel 可還原）
    }
  }

  const onMeta = (payload: RealtimePostgresChangesPayload<SystemMetaRow>): void => {
    changeCount += 1 // N1
    if (payload.eventType === 'DELETE') {
      const key = payload.old.key
      if (key !== undefined) {
        store.setState({ meta: removeByKey(store.getState().meta, (m) => m.key, key) })
      }
      return
    }
    mergeMeta(store, payload.new)
  }

  const onTag = (payload: RealtimePostgresChangesPayload<TagRow>): void => {
    changeCount += 1 // N1
    if (payload.eventType === 'DELETE') {
      const name = payload.old.name
      if (name !== undefined) {
        store.setState({ tags: removeByKey(store.getState().tags, (t) => t.name, name) })
      }
      return
    }
    mergeTag(store, payload.new)
  }

  const onCycleDay = (payload: RealtimePostgresChangesPayload<CycleDayRow>): void => {
    changeCount += 1 // N1
    if (payload.eventType === 'DELETE') {
      if (payload.old.date === hkTodayDateString(Date.now())) store.setState({ cycleToday: null })
      return
    }
    mergeCycleDay(store, payload.new, hkTodayDateString(Date.now()))
  }

  const channel = client
    .channel(CHANNEL_NAME)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onTask)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'system_meta' }, onMeta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, onTag)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cycle_days' }, onCycleDay)
    .subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        store.setState({ connected: true })
        if (everLost) {
          everLost = false
          scheduleReload() // 重連成功 → debounce 3s 靜默全量 reload（補返斷線期間錯過嘅變更）
        }
      } else if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
        status === REALTIME_SUBSCRIBE_STATES.CLOSED
      ) {
        store.setState({ connected: false })
        everLost = true
      }
    })

  // 網絡恢復：唔理 everLost 都觸發一次 resync（debounce 內同重連 reload 會合併）。
  const onOnline = (): void => {
    scheduleReload()
  }
  window.addEventListener('online', onOnline)

  return {
    channel,
    changeCount: () => changeCount, // N1
    unsubscribe: async () => {
      reloadTimer = clearTimer(reloadTimer)
      usageTimer = clearTimer(usageTimer)
      window.removeEventListener('online', onOnline)
      await client.removeChannel(channel)
    },
  }
}
