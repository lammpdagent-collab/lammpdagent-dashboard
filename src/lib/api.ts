/**
 * Supabase IO 層 —— 全部 supabase-js 呼叫集中喺度；唔碰 DOM、唔碰 store。
 * 每個函式一律收 client 做第一參數（main.ts 用 getSupabase() 傳入），
 * 出錯就 throw，由呼叫方（main.ts / store 樂觀更新）決定 rollback 同 toast。
 *
 * 寫入紀律（Phase 1 欄級 grant，migration 20261126004259）：
 * - UPDATE patch 白名單九欄：title / notes / due_date / priority / category /
 *   status / pinned / tags / deleted_at（TaskPatch 型別 + assertTaskPatchAllowed 執行期雙重把關）。
 * - `completed_at` / `updated_at` 由 trigger 獨佔，`source` / `source_ref` / `id` /
 *   `created_at` 冇 update grant —— 永遠唔由 client 送（送咗會令整句 UPDATE 被拒）。
 * - INSERT payload 白名單只有 { title, source: 'web' }；實際只送 { title }，
 *   source='web'、priority/status/category 等 DB default 補（tasks.md 3.3）。
 * - 刪除一律 UPDATE `deleted_at`（soft delete）；tasks 冇 DELETE grant，
 *   唔會發出任何 DELETE 請求。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventWindow } from './eventQuery'
import { rowsWithTag } from './tagCatalog'
import { hkDayStartEpoch, hkTodayDateString } from './time'
import type { CycleDayRow, EventRow, SystemMetaRow, TagRow, TaskRow } from './types'

/** 讀結果通用：有 error 就 throw（訊息帶埋 PostgREST 原文）。 */
function throwOnError(error: { message: string } | null, action: string): void {
  if (error !== null) throw new Error(`${action}失敗：${error.message}`)
}

// ---------------------------------------------------------------------------
// N8：全表式讀取分頁（PostgREST 預設 max rows = 1000）
// ---------------------------------------------------------------------------

/** 一頁行數——貼住 Supabase 預設 max rows = 1000。 */
const PAGE_SIZE = 1000

/**
 * N8：PostgREST 預設 max rows = 1000——查詢結果多過會**靜默截斷**。
 * 「撈全表再本地過濾」嘅查詢（m3：fetchTaskRowsWithTag / fetchTaskTagRows）
 * 一律經呢個 helper：`.range(from, from+999)` 循環，直到回傳少於 1000 行
 * （即已到底）。任一頁出錯即刻 throw（語意同單頁查詢一致：一嘢都未套用）。
 * 前提：server max rows ≥ PAGE_SIZE（Supabase 預設 1000）；若調低過，
 * 頁會短於 1000 而提前終止——同唔分頁一樣，唔會更差。
 */
async function fetchAllPages<T>(
  action: string,
  page: (range: { from: number; to: number }) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await page({ from, to: from + PAGE_SIZE - 1 })
    throwOnError(error, action)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) return all // 尾頁（或少過一頁）→ 已到底
    from += PAGE_SIZE
  }
}

// ---------------------------------------------------------------------------
// N2：寫入 timeout
// ---------------------------------------------------------------------------

/**
 * supabase-js 冇預設 timeout：TCP half-open（移動網絡斷線等）時請求可能永遠
 * pending → withPendingWrite 計數永遠唔歸零 → resync 永久鎖死、樂觀 patch
 * 永遠唔 rollback。所有寫入一律 race 20 秒 timeout；超時視為失敗（throw），
 * rollback 同 toast 由呼叫方原有嘅 catch 路徑處理（optimisticUpdate catch /
 * INSERT_FAILED_TOAST 等）。
 */
/**
 * N2：寫入 timeout。supabase builder 係 PromiseLike（PostgrestBuilder），
 * 入面先 Promise.resolve 轉做真 Promise 先有 .catch／race 用。
 */
const WRITE_TIMEOUT_MS = 20_000

function withWriteTimeout<T>(write: PromiseLike<T>, action: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${action}逾時（${WRITE_TIMEOUT_MS / 1000} 秒無回應）`)),
      WRITE_TIMEOUT_MS,
    )
  })
  const writePromise = Promise.resolve(write)
  // 輸家（卡死嘅請求）遲到先 reject 嘅話唔好變 unhandled rejection。
  void writePromise.catch(() => {})
  return Promise.race([writePromise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

// ---------------------------------------------------------------------------
// 讀取（initial load）
// ---------------------------------------------------------------------------

/**
 * 任務 initial 查詢：未完成 + 今日完成（§4.3）。
 * `.or()` 內時戳由 toISOString() 產生（'…Z' 結尾，無 '+'），唔會撞 PostgREST
 * filter 語法（風險 #5）。排序交由 sortTasks（taskQuery）做，DB 唔使 order。
 */
export async function fetchTasks(client: SupabaseClient, now: number): Promise<TaskRow[]> {
  const todayStartIso = new Date(hkDayStartEpoch(hkTodayDateString(now))).toISOString()
  const { data, error } = await client
    .from('tasks')
    .select('*')
    .is('deleted_at', null)
    .or(`status.neq.done,completed_at.gte.${todayStartIso}`)
  throwOnError(error, '載入任務')
  return (data ?? []) as TaskRow[]
}

/**
 * 撈帶有指定 tag 嘅任務行（§4.5「移除使用中 tag」批量流程用）。
 * **含軟刪行**（清理時一併 strip，invisible 唔代表唔使清資料），
 * deleted_at 用嚟計「影響中嘅可見任務數」俾確認對話顯示。
 *
 * m3：唔用 `.contains('tags', [name])`——postgrest-js 會串成 `cs.{a,b}` 陣列
 * 語法，tag 名含逗號／`}`／`"` 會被誤拆成多個元素或報 400（affected 計錯 →
 * 唔彈確認、照 deleteTag 但任務 tags 冇清）。改為撈全部行嘅 id / tags /
 * deleted_at，再用 tagCatalog.rowsWithTag 本地過濾（同 fetchTaskTagRows
 * 同款做法；任務表細、操作低頻，可接受）。
 *
 * N8：全表撈行改經 fetchAllPages 分頁——任務累積過千（PostgREST 預設
 * max rows = 1000）唔會靜默漏行，令 affected 計錯／tags 清唔乾淨。
 */
export async function fetchTaskRowsWithTag(
  client: SupabaseClient,
  name: string,
): Promise<Array<Pick<TaskRow, 'id' | 'tags' | 'deleted_at'>>> {
  const rows = await fetchAllPages<Pick<TaskRow, 'id' | 'tags' | 'deleted_at'>>(
    '載入使用中標籤',
    ({ from, to }) => client.from('tasks').select('id, tags, deleted_at').range(from, to),
  )
  return rowsWithTag(rows, name)
}

/**
 * tag usage 用嘅獨立細查詢（R1-5：全部 `deleted_at is null` 任務，含舊 done）。
 * 只揀 tags + deleted_at 兩欄（deleted_at 恒為 null，查詢已過濾；tagUsageCounts 內部檢查需要呢個欄位存在）。
 * N8：分頁撈——任務累積過千（PostgREST 預設 max rows = 1000）唔會靜默漏行
 * 令 usage 計少。
 */
export async function fetchTaskTagRows(
  client: SupabaseClient,
): Promise<Array<Pick<TaskRow, 'tags' | 'deleted_at'>>> {
  return fetchAllPages<Pick<TaskRow, 'tags' | 'deleted_at'>>(
    '載入標籤用量',
    ({ from, to }) =>
      client.from('tasks').select('tags, deleted_at').is('deleted_at', null).range(from, to),
  )
}

/**
 * 事件 initial 查詢（窗口條件，D9 / R1-1）：
 * `cancelled_at is null` 且 `end_time > 今日00:00`（嚴格大於）且
 * `start_time < 今日+7日00:00`（嚴格小於）。window 由 buildEventWindow(now) 產生。
 */
export async function fetchEvents(client: SupabaseClient, window: EventWindow): Promise<EventRow[]> {
  const { data, error } = await client
    .from('events')
    .select('*')
    .is('cancelled_at', null)
    .gt('end_time', window.startIso)
    .lt('start_time', window.endIso)
  throwOnError(error, '載入事件')
  return (data ?? []) as EventRow[]
}

/** tag 目錄全部行。 */
export async function fetchTags(client: SupabaseClient): Promise<TagRow[]> {
  const { data, error } = await client.from('tags').select('*')
  throwOnError(error, '載入標籤目錄')
  return (data ?? []) as TagRow[]
}

/** 指定日期（一般係今日）嘅循環日；冇行回 null（maybeSingle）。 */
export async function fetchTodayCycleDay(client: SupabaseClient, dateStr: string): Promise<CycleDayRow | null> {
  const { data, error } = await client
    .from('cycle_days')
    .select('*')
    .eq('date', dateStr)
    .maybeSingle()
  throwOnError(error, '載入循環日')
  return (data ?? null) as CycleDayRow | null
}

/** 同步狀態（calendar_sync:personal / :work 兩行）。 */
export async function fetchSystemMeta(client: SupabaseClient): Promise<SystemMetaRow[]> {
  const { data, error } = await client.from('system_meta').select('*')
  throwOnError(error, '載入同步狀態')
  return (data ?? []) as SystemMetaRow[]
}

// ---------------------------------------------------------------------------
// is_owner RPC（R1-6 / D13）
// ---------------------------------------------------------------------------

/**
 * owner 判定經 RPC `is_owner()`：owner email 只存 DB，bundle 零 email。
 * RPC 失敗就 throw；permission denied（session 異常）等情況由 auth.checkOwner
 * 分流做 not-owner / 'error'（§4.9）。
 */
export async function isOwner(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('is_owner')
  throwOnError(error, '驗證存取權')
  return data === true
}

// ---------------------------------------------------------------------------
// 寫入
// ---------------------------------------------------------------------------

/**
 * UPDATE patch 白名單 = Phase 1 update grant 嘅九個欄位（migration 20261126004259）。
 * `completed_at` / `updated_at` / `source` / `source_ref` / `id` / `created_at`
 * 刻意唔喺型別內——client 永遠唔送（completed_at / updated_at 由 trigger 獨佔）。
 */
export type TaskPatch = Partial<
  Pick<
    TaskRow,
    | 'title'
    | 'notes'
    | 'due_date'
    | 'priority'
    | 'category'
    | 'status'
    | 'pinned'
    | 'tags'
    | 'deleted_at'
  >
>

const TASK_PATCH_KEYS: readonly string[] = [
  'title',
  'notes',
  'due_date',
  'priority',
  'category',
  'status',
  'pinned',
  'tags',
  'deleted_at',
]

/** 執行期防禦：patch 有九欄以外嘅 key（例如 completed_at）就即刻擋，唔發請求。 */
function assertTaskPatchAllowed(patch: TaskPatch): void {
  for (const key of Object.keys(patch)) {
    if (!TASK_PATCH_KEYS.includes(key)) {
      throw new Error(`updateTask patch 含未授權欄位「${key}」（只限 Phase 1 update grant 九欄）`)
    }
  }
}

/**
 * INSERT payload 白名單：只有 title（用戶輸入）同 source（固定 'web' 字面值）。
 * 實際呼叫只送 { title } —— source='web'、priority/status/category 等 DB default 補。
 */
export interface TaskInsertPayload {
  title: string
  source?: 'web'
}

/** 新增任務：INSERT 之後 .select().single() 攞返完整行（DB default 已補齊）。 */
export async function insertTask(client: SupabaseClient, payload: TaskInsertPayload): Promise<TaskRow> {
  const { data, error } = await withWriteTimeout( // N2：寫入加 20s timeout
    client.from('tasks').insert(payload).select().single(),
    '新增任務',
  )
  throwOnError(error, '新增任務')
  if (data === null) throw new Error('新增任務失敗：無回傳資料')
  return data as TaskRow
}

/**
 * 更新任務欄位。patch 必須限 Phase 1 grant 九欄（見 TaskPatch）；
 * 執行期再擋一次，任何未授權 key 會喺發請求前 throw。
 */
export async function updateTask(client: SupabaseClient, id: string, patch: TaskPatch): Promise<TaskRow> {
  assertTaskPatchAllowed(patch)
  const { data, error } = await withWriteTimeout( // N2：寫入加 20s timeout
    client.from('tasks').update(patch).eq('id', id).select().single(),
    '更新任務',
  )
  throwOnError(error, '更新任務')
  if (data === null) throw new Error('更新任務失敗：無回傳資料')
  return data as TaskRow
}

/** 改任務 tags 陣列（整個陣列替換）。批量移除 tag 嘅「逐行 update」就用呢個（R1-4 等價 `array_remove`）。 */
export async function updateTaskTags(client: SupabaseClient, id: string, tags: string[]): Promise<TaskRow> {
  return updateTask(client, id, { tags })
}

/**
 * Soft delete：只 UPDATE `deleted_at` 欄（tasks 冇 DELETE grant，唔會發 DELETE 請求）。
 * `completed_at` 等其他欄一律唔掂。
 */
export async function softDeleteTask(client: SupabaseClient, id: string): Promise<TaskRow> {
  return updateTask(client, id, { deleted_at: new Date().toISOString() })
}

/**
 * 新增 tag 目錄項：upsert onConflict='name' + ignoreDuplicates —— 重複新增唔報錯
 * （spec scenario）。DO NOTHING 時回空陣列，所以有需要就回讀現有行。
 */
export async function insertTag(client: SupabaseClient, name: string): Promise<TagRow> {
  const { data, error } = await withWriteTimeout( // N2：寫入加 20s timeout
    client.from('tags').upsert({ name }, { onConflict: 'name', ignoreDuplicates: true }).select(),
    '新增標籤',
  )
  throwOnError(error, '新增標籤')
  const rows = (data ?? []) as TagRow[]
  if (rows.length > 0) return rows[0]
  const { data: existing, error: readError } = await withWriteTimeout( // N2
    client.from('tags').select().eq('name', name).single(),
    '新增標籤後回讀',
  )
  throwOnError(readError, '新增標籤後回讀')
  if (existing === null) throw new Error('新增標籤後回讀失敗：無回傳資料')
  return existing as TagRow
}

/** 刪除 tag 目錄行（tags 有 DELETE grant；tasks 嘅 tags 欄清理由 stripTag 批量流程另行 UPDATE）。 */
export async function deleteTag(client: SupabaseClient, name: string): Promise<void> {
  const { error } = await withWriteTimeout( // N2：寫入加 20s timeout
    client.from('tags').delete().eq('name', name),
    '刪除標籤',
  )
  throwOnError(error, '刪除標籤')
}
