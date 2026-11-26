/**
 * 任務純邏輯 —— 可見性（initial query 與 realtime merge 共用）、列表排序、
 * 完成狀態切換、tag 使用次數。唔碰 DOM、唔碰 supabase。
 */
import type { TaskRow, TaskStatus } from './types'
import { addDays, hkDayStartEpoch, hkTodayDateString } from './time'

/** due_date NULL 排最後用嘅哨兵（ISO 字串比較下大過任何真實日期）。 */
const DUE_TAIL = '9999-12-31'

/** priority → 權重（小 = 前）。CHECK 已擋枚舉值；未知值（理論不會出現）排 low 之後。 */
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const

function priorityRank(priority: string): number {
  return priority in PRIORITY_RANK ? PRIORITY_RANK[priority as keyof typeof PRIORITY_RANK] : 4
}

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const cmpDesc = (a: number, b: number): number => cmpNum(b, a)

/**
 * 任務可見性：`deleted_at` 為 NULL，且（`status !== 'done'`，或 done 而
 * `completed_at` 落喺 HK 今日 [00:00, 翌日 00:00)）。
 * Initial query 只用下界（done 必有 completed_at，trigger 保證）；merge 用完整判斷。
 */
export function isVisibleTask(row: TaskRow, now: number): boolean {
  if (row.deleted_at !== null) return false
  if (row.status !== 'done') return true
  if (row.completed_at === null) return false
  const completedMs = Date.parse(row.completed_at)
  const todayStr = hkTodayDateString(now)
  const dayStart = hkDayStartEpoch(todayStr)
  const nextDayStart = hkDayStartEpoch(addDays(todayStr, 1))
  return completedMs >= dayStart && completedMs < nextDayStart
}

/** done 群內部：completed_at 新者先（啱啱做完嘅喺最上），再 created_at 新者先。 */
function compareDone(a: TaskRow, b: TaskRow): number {
  // Date.parse('') = NaN；NaN 比較全部 false → cmp 回 0，由次級鍵決定（防禦性）
  const byCompleted = cmpDesc(Date.parse(a.completed_at ?? ''), Date.parse(b.completed_at ?? ''))
  if (byCompleted !== 0) return byCompleted
  return cmpDesc(Date.parse(a.created_at), Date.parse(b.created_at))
}

/**
 * 排序 comparator（逐級）：
 * 1. done 排最後（done 群內 completed_at 新者先）
 * 2. pinned 先
 * 3. status='park' 先（design D8：park 係「等緊人」，要持續見到）
 * 4. priority：critical > high > medium > low
 * 5. due_date 近者先（ISO 字串比較即日期序；NULL 排最後）
 * 6. created_at 新者先（用 epoch 比較，避開 +00:00/Z 格式混雜）
 */
export function compareTasks(a: TaskRow, b: TaskRow): number {
  const aDone = a.status === 'done'
  const bDone = b.status === 'done'
  if (aDone !== bDone) return aDone ? 1 : -1
  if (aDone) return compareDone(a, b)
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  const aPark = a.status === 'park'
  const bPark = b.status === 'park'
  if (aPark !== bPark) return aPark ? -1 : 1
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
  if (byPriority !== 0) return byPriority
  const dueA = a.due_date ?? DUE_TAIL
  const dueB = b.due_date ?? DUE_TAIL
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  return cmpDesc(Date.parse(a.created_at), Date.parse(b.created_at))
}

/** 回新排好嘅陣列（唔 mutate 輸入）。 */
export function sortTasks(rows: readonly TaskRow[]): TaskRow[] {
  return [...rows].sort(compareTasks)
}

/**
 * R3-1：done → 'todo'；其餘（todo/park）→ 'done'。
 * park 任務做完再取消會變 'todo'，唔還原 park。
 */
export function toggleStatus(current: TaskStatus): TaskStatus {
  return current === 'done' ? 'todo' : 'done'
}

/**
 * R1-5：tag 使用次數 = 全部 `deleted_at` 為 NULL 任務嘅 tags 欄逐項計數
 * （含已 done 嘅舊任務）。輸入一般係 api.fetchTaskTagRows 嘅結果
 * （只揀 tags + deleted_at 兩欄；deleted_at 恒為 null —— 查詢已過濾）。
 */
export function tagUsageCounts(
  rows: ReadonlyArray<Pick<TaskRow, 'tags' | 'deleted_at'>>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.deleted_at !== null) continue
    for (const tag of row.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}
