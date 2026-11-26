/**
 * App 型別 —— row 型別全部由 src/types/db.ts（supabase gen types 生成）derive。
 * db.ts 係生成檔，唔好手改；schema 改動後重新生成。
 */
import type { Database } from '../types/db'

type T = Database['public']['Tables']

export type TaskRow = T['tasks']['Row']
export type EventRow = T['events']['Row']
export type SystemMetaRow = T['system_meta']['Row']
export type TagRow = T['tags']['Row']
export type CycleDayRow = T['cycle_days']['Row']

/**
 * CHECK 欄位嘅聯集型別：gen types 對 text + CHECK constraint 只會出 string，
 * 呢幾個 union 鏡像 Phase 1 migration（20261126004259）嘅 CHECK——
 * 改 DB 枚舉值時兩處一齊改。執行期值由 CHECK constraint 保證。
 */
export type TaskStatus = 'todo' | 'done' | 'park'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type SyncSource = 'personal' | 'work'

export type AppView = 'loading' | 'login' | 'blocked' | 'ready' | 'error'

export interface UpcomingDay {
  dateStr: string
  label: string
  events: EventRow[]
}

export interface EventGroups {
  today: EventRow[]
  tomorrow: EventRow[]
  upcoming: UpcomingDay[]
}

export interface SyncWarning {
  source: SyncSource
  text: string
}
