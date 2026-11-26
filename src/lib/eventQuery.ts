/**
 * 事件純邏輯 —— 查詢窗口、clone 副本過濾、Today/Tomorrow/Upcoming 分組、
 * 單行顯示狀態。唔碰 DOM、唔碰 supabase。
 */
import type { EventGroups, EventRow, UpcomingDay } from './types'
import { addDays, formatGroupTitle, hkDayStartEpoch, hkTodayDateString } from './time'

/** clone 判定容差：|start 差| ≤ 5 分鐘（R1-7）。 */
const CLONE_TOLERANCE_MS = 5 * 60 * 1000

/** 分組候選日數：今日 + 聽日 + Upcoming 第 2–6 日 = 7 日（R1-1）。 */
const GROUP_DAYS = 7

export interface EventWindow {
  /** HK 今日 00:00（toISOString 產生 '…Z'，避免 '+' 入 PostgREST filter 語法） */
  startIso: string
  /** HK 今日+7日 00:00 —— 查詢條件 `start_time < endIso`（R1-1：+7 日） */
  endIso: string
}

/**
 * 事件查詢窗口：`end_time > 今日00:00`（嚴格大於，D9 邊界）且
 * `start_time < 今日+7日00:00`（嚴格小於）。
 *
 * 窗口↔分組對應：分組候選日 i=0..6 各覆蓋 [S_i, S_{i+1})，並集 = [S0, S7)。
 * 事件與 [S0, S7) 有重疊 ⟺ end > S0 ∧ start < S7 ⟺ 正好係查詢條件，
 * 所以任何 fetched 事件必落某組（「查到必顯示」，tests/eventQuery 有性質測試鎖定）。
 */
export function buildEventWindow(now: number): EventWindow {
  const todayStr = hkTodayDateString(now)
  const startMs = hkDayStartEpoch(todayStr)
  const endMs = hkDayStartEpoch(addDays(todayStr, GROUP_DAYS))
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

/**
 * R1-7：`account_key='personal'` 事件若與某 `account_key='work'` 事件
 * trim 後標題相同且 |start_time 差| ≤ 5 分鐘 → clone 副本，唔渲染
 * （用普通 `.trim()`，唔做正規化）。work 原件一定保留——寧可多一行，不可漏資料。
 * O(n)：第一次掃描按 trim(title) 收集 work start，第二次掃描核對 personal。
 */
export function filterClones(rows: readonly EventRow[]): EventRow[] {
  const workStarts = new Map<string, number[]>()
  for (const row of rows) {
    // NIT3：已取消嘅 work 事件唔可以壓住 personal 副本（否則極端情況會漏一行）；
    // cancelled 行本身照留喺結果——由 groupEvents 過濾，un-cancel 可還原。
    if (row.account_key !== 'work' || row.cancelled_at !== null) continue
    const key = row.title.trim()
    const starts = workStarts.get(key)
    if (starts === undefined) {
      workStarts.set(key, [Date.parse(row.start_time)])
    } else {
      starts.push(Date.parse(row.start_time))
    }
  }
  return rows.filter((row) => {
    if (row.account_key !== 'personal') return true
    const starts = workStarts.get(row.title.trim())
    if (starts === undefined) return true
    const start = Date.parse(row.start_time)
    return !starts.some((workStart) => Math.abs(start - workStart) <= CLONE_TOLERANCE_MS)
  })
}

/**
 * 日內排序：全日最前（標「全日」）→ start_time 升序 → end_time 升序 →
 * 標題 zh-Hant 字母序。回新陣列（唔 mutate）。
 */
export function sortWithinDay(rows: readonly EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => {
    if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1
    const startA = Date.parse(a.start_time)
    const startB = Date.parse(b.start_time)
    if (startA !== startB) return startA < startB ? -1 : 1
    const endA = Date.parse(a.end_time)
    const endB = Date.parse(b.end_time)
    if (endA !== endB) return endA < endB ? -1 : 1
    return a.title.localeCompare(b.title, 'zh-Hant')
  })
}

/**
 * 分組成今日 / 聽日 / Upcoming：
 * - 每事件歸**首個重疊日**（`start < S_{i+1} && end > S_i`；跨日同疊今日+聽日
 *   → 只歸今日）。窗口外行（end ≤ S0 或 start ≥ S7）唔會出現喺任何組。
 * - Upcoming（i=2..6，R1-1 第 2–6 日）只收 `relevance='linked'`；
 *   今日／聽日唔過濾 relevance（含 noise）。
 * - Upcoming 逐日只列有 linked 事件嘅日；過濾後全空時 `upcoming` 為空陣列
 *   （R3-2：render 層照出標題＋「無事件」，唔隱藏區塊）。
 * - `cancelled_at` 非 NULL 一律唔分組：initial query 已濾；realtime 把事件
 *   設 cancelled 後靠呢層即時收起，反向 un-cancel 自動還原。
 */
export function groupEvents(rows: readonly EventRow[], now: number): EventGroups {
  const todayStr = hkTodayDateString(now)
  const dayStarts = Array.from({ length: GROUP_DAYS + 1 }, (_, i) =>
    hkDayStartEpoch(addDays(todayStr, i)),
  )
  const buckets: EventRow[][] = Array.from({ length: GROUP_DAYS }, () => [])
  for (const row of rows) {
    if (row.cancelled_at !== null) continue
    const start = Date.parse(row.start_time)
    const end = Date.parse(row.end_time)
    for (let i = 0; i < GROUP_DAYS; i++) {
      if (start < dayStarts[i + 1] && end > dayStarts[i]) {
        buckets[i].push(row)
        break
      }
    }
  }
  const upcoming: UpcomingDay[] = []
  for (let i = 2; i < GROUP_DAYS; i++) {
    const linked = buckets[i].filter((row) => row.relevance === 'linked')
    if (linked.length === 0) continue
    const dateStr = addDays(todayStr, i)
    upcoming.push({
      dateStr,
      label: formatGroupTitle('', dateStr), // '29/11（日）'，R1-8
      events: sortWithinDay(linked),
    })
  }
  return {
    today: sortWithinDay(buckets[0]),
    tomorrow: sortWithinDay(buckets[1]),
    upcoming,
  }
}

/** 單行顯示狀態（main.ts 據此加 .past/.allday class 同「進行中」標籤）。 */
export interface EventDisplayState {
  /** `end_time ≤ now` → 變灰（同日已過、跨日已結束都算） */
  past: boolean
  /** 跨日未結束（`start < 今日00:00 && end > now`）→「進行中（至 HH:MM）」；
   *  同日進行中事件唔標示（Conflicts #2 拍板） */
  ongoing: boolean
  /** 全日事件：render 顯示「全日」，永遠唔出 00:00 */
  allDay: boolean
}

/** 「已過」一律以 end_time ≤ now 判定；「進行中」只俾跨日未結束事件。 */
export function eventState(row: EventRow, now: number): EventDisplayState {
  const end = Date.parse(row.end_time)
  const start = Date.parse(row.start_time)
  const todayStart = hkDayStartEpoch(hkTodayDateString(now))
  return {
    past: end <= now,
    ongoing: start < todayStart && end > now,
    allDay: row.is_all_day,
  }
}
