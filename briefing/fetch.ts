// ---------------------------------------------------------------------------
// briefing/fetch.ts —— 日報 / 下午報 / 任意範圍查詢 CLI（add-daily-briefing，plan Step 4–5）
//
// 上半部：可測純函數層（HKT 時間窗、args／`.env` parse、staleness、排序分組、分頁 helper）。
// 下半部：CLI 接線（runCli 注入 deps + realDeps + main + direct-run guard）。
//
// 紀律：
// - parseArgs 先於任何 I/O：驗證唔過就 exit 1，唔讀 .env、唔連 DB。
// - stdout 紀律：成個 payload 砌好先一次過出；中途任何失敗都唔會有部分 JSON 出街。
// - 落 DB 嘅時間一律 .toISOString()（Z 尾，唔好 `+08:00` 字面值）；HKT 用 +8h 算術（香港無 DST）。
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { createClient } from '@supabase/supabase-js'
import { classifyRelevance } from './relevance.ts'
import type { Relevance } from './relevance.ts'

// ---------------------------------------------------------------------------
// 型別——briefing/ 自帶精簡 row 型別（只含 select 嘅欄位），唔 import src/types/
// ---------------------------------------------------------------------------

/** events 表 select 出嚟嘅欄位（唔含 DB 嘅 relevance 欄——輸出嘅 relevance 係計算值）。 */
export interface EventRow {
  id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
  account_key: string
  source_calendar: string | null
}

/** tasks 表 select 出嚟嘅欄位（created_at 係排序 tiebreak 用，唔入輸出）。 */
export interface TaskRow {
  id: string
  title: string
  priority: string
  category: string
  due_date: string | null
  pinned: boolean
  created_at: string
}

/** cycle_days 表 select 出嚟嘅欄位。 */
export interface CycleRow {
  date: string
  day_label: string
}

/** system_meta 表 select 出嚟嘅欄位。 */
export interface MetaRow {
  key: string
  last_run_at: string | null
  status: string
  message: string | null
}

export type PriorityGroup = 'critical' | 'high' | 'medium' | 'low'

/** 輸出契約嘅 event。 */
export interface EventOut {
  id: string
  title: string
  start_time: string
  end_time: string
  is_all_day: boolean
  account_key: string
  source_calendar: string | null
  relevance: Relevance
}

/** 輸出契約嘅 task（overdue 由 due_date 對照 HKT 今日計算）。 */
export interface TaskOut {
  id: string
  title: string
  priority: string
  category: string
  due_date: string | null
  pinned: boolean
  overdue: boolean
}

/** sync.sources 逐項——DB 原值輸出（r4 m2），`last_run_at` 唔重排格式；缺行嘅 key 唔出現。 */
export interface SyncSource {
  key: string
  last_run_at: string | null
  status: string
}

export interface SyncStatus {
  stale: boolean
  reason: string | null
  /** 兩個同步來源嘅現況（r4 m2 絕對時間）；briefing／query 兩種 payload 共用。 */
  sources: SyncSource[]
}

/** morning / afternoon 輸出契約。 */
export interface BriefingPayload {
  generated_at: string
  date: string
  weekday: string
  sync: SyncStatus
  cycle: { today: string | null; tomorrow: string | null }
  today: EventOut[]
  upcoming: EventOut[]
  tasks: Record<PriorityGroup, TaskOut[]>
}

/** query 模式輸出契約。 */
export interface QueryPayload {
  generated_at: string
  range: { from: string; to: string }
  sync: SyncStatus
  events: EventOut[]
  tasks: TaskOut[]
}

/** 注入式依賴——測試用假 deps，真 CLI 用 createRealDeps()。 */
export interface Deps {
  /**
   * `allDayFromIso` 有值（afternoon）→ 全日事件唔受 `fromIso`（13:00）下界限制，
   * 改受 all-day 專屬下界 `allDayFromIso`（今日 00:00 HKT）限制（r4 M2，spec「Afternoon 模式窗口」）。
   */
  queryEvents: (fromIso: string, toIso: string, allDayFromIso?: string | null) => Promise<EventRow[]>
  queryTasks: () => Promise<TaskRow[]>
  queryCycleDays: (dates: string[]) => Promise<CycleRow[]>
  querySystemMeta: (keys: string[]) => Promise<MetaRow[]>
  now: () => Date
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

// ---------------------------------------------------------------------------
// 去重（batch 3b：personal／work 兩邊同一活動撞晒 key 時只留一份）
// ---------------------------------------------------------------------------

/** dedupeEvents 最低需求欄位（EventRow 天然滿足）。 */
export interface DedupeableEvent {
  id: string
  title: string
  start_time: string
  account_key: string
}

/** 去重後重排用，同 compareEvents 同一序：is_all_day DESC（全日先）→ start_time ASC → id ASC。 */
function compareDedupeOrder(
  a: { id: string; start_time: string; is_all_day?: boolean },
  b: { id: string; start_time: string; is_all_day?: boolean },
): number {
  return (
    Number(b.is_all_day === true) - Number(a.is_all_day === true) ||
    Date.parse(a.start_time) - Date.parse(b.start_time) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/**
 * 事件去重。key = `title.trim() + '\u0000' + start_time 截到分鐘`（UTC ISO 前 16 字，秒位唔計；
 * 分隔符用 NUL——r4 N2：title 可以含 `|`，用 `|` 分隔會撞 key）。
 * 撞 key 時：
 * - 現有 personal、新 work → 用新的取代（work 優先）；
 * - 現有 work、新 personal → 保留現有；
 * - 同 account（或其他組合）→ 保留 id 字典序較細。
 * 只 trim 前後空白：唔 normalize 大小寫、唔 normalize 內部空白（`A B` 同 `A  B` 係兩件事）。
 * `start_time` 非 ISO（Date.parse NaN）→ 丟帶 event id 嘅明確錯誤（r4 m3）。
 * 回傳去重後陣列，按 compareDedupeOrder 重新排序（work 取代會換走一行，id 可能變）。
 */
export function dedupeEvents<T extends DedupeableEvent>(events: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const event of events) {
    const ms = Date.parse(event.start_time)
    if (!Number.isFinite(ms)) {
      throw new Error(`invalid start_time for event ${event.id}: ${event.start_time}`)
    }
    const key = `${event.title.trim()}\u0000${new Date(ms).toISOString().slice(0, 16)}`
    const existing = byKey.get(key)
    if (existing == null) {
      byKey.set(key, event)
      continue
    }
    if (existing.account_key === 'personal' && event.account_key === 'work') {
      byKey.set(key, event)
    } else if (existing.account_key === 'work' && event.account_key === 'personal') {
      // work 優先——保留現有
    } else {
      byKey.set(key, event.id < existing.id ? event : existing)
    }
  }
  return [...byKey.values()].sort(compareDedupeOrder)
}

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** HKT = UTC+8；香港無 DST，直接 +8h 算術就得。 */
export const HKT_OFFSET_MS = 8 * 60 * 60 * 1000

/** Supabase REST server-side max-rows 預設 1000。 */
const PAGE_SIZE = 1000

/** system_meta 兩個同步來源 key。 */
const SYNC_KEYS: string[] = ['calendar_sync:personal', 'calendar_sync:work']

/** 同步新鮮度上限：距今 ≤26 小時算新鮮（剛好 26h 都算新鮮，「唔超過」）。 */
const FRESH_HOURS_MAX = 26

/** query 模式範圍上限：`to - from > 366` 日 → 非零 exit（剛好 366 日允許）。 */
const MAX_RANGE_DAYS = 366

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

// ---------------------------------------------------------------------------
// HKT 時間窗（一律回 UTC `Z` ISO 字串；日期加減用 UTC epoch + n*86400000，無 DST 問題）
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD'（HKT 日曆日）當日 00:00 HKT 嘅 UTC 時刻。 */
export function hktDayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00+08:00`)
}

/** `now` 所在嘅 HKT 日曆日（YYYY-MM-DD）。技巧：+8h 之後讀 UTC 部分 = HKT 牆鐘。 */
export function hktDateStr(now: Date): string {
  return new Date(now.getTime() + HKT_OFFSET_MS).toISOString().slice(0, 10)
}

/** 今日 00:00 HKT，回 UTC Date。 */
export function hktTodayStartUtc(now: Date): Date {
  return hktDayStartUtc(hktDateStr(now))
}

/** 明日 00:00 HKT，回 UTC Date。 */
export function hktTomorrowStartUtc(now: Date): Date {
  return new Date(hktTodayStartUtc(now).getTime() + DAY_MS)
}

function isoWindow(startUtc: Date, endUtc: Date): [string, string] {
  return [startUtc.toISOString(), endUtc.toISOString()]
}

/**
 * [date 00:00 HKT, +1日 00:00 HKT)。
 * @internal production 唔直接用（morning／afternoon／upcoming 有專屬窗），只由測試 W1 作對照。
 */
export function hktDayWindow(date: string): [string, string] {
  const start = hktDayStartUtc(date)
  return isoWindow(start, new Date(start.getTime() + DAY_MS))
}

/** morning DB 查詢窗：[今日 00:00 HKT, 第8日 00:00 HKT)（一次拉齊，記憶體分區）。 */
export function hktMorningWindow(date: string): [string, string] {
  const start = hktDayStartUtc(date)
  return isoWindow(start, new Date(start.getTime() + 8 * DAY_MS))
}

/** afternoon DB 查詢窗：[今日 13:00 HKT, 明日 00:00 HKT)。 */
export function hktAfternoonWindow(date: string): [string, string] {
  const dayStart = hktDayStartUtc(date)
  return isoWindow(new Date(dayStart.getTime() + 13 * 60 * 60 * 1000), new Date(dayStart.getTime() + DAY_MS))
}

/** query DB 查詢窗：[from 00:00 HKT, (to+1日) 00:00 HKT)——to 含尾日。 */
export function hktQueryWindow(from: string, to: string): [string, string] {
  return isoWindow(hktDayStartUtc(from), new Date(hktDayStartUtc(to).getTime() + DAY_MS))
}

/** upcoming 分區窗（00:00 HKT 邊界）：linked [+1日, +8日)、context [+1日, +3日)。 */
export function hktUpcomingWindows(date: string): { linked: [string, string]; context: [string, string] } {
  const dayStart = hktDayStartUtc(date)
  const tomorrow = new Date(dayStart.getTime() + DAY_MS)
  return {
    linked: isoWindow(tomorrow, new Date(dayStart.getTime() + 8 * DAY_MS)),
    context: isoWindow(tomorrow, new Date(dayStart.getTime() + 3 * DAY_MS)),
  }
}

/** generated_at（`+08:00` 字面，秒位）/ HKT 日曆日 / 星期幾。 */
export function hktNowParts(now: Date): { generated_at: string; date: string; weekday: string } {
  const shifted = new Date(now.getTime() + HKT_OFFSET_MS)
  const iso = shifted.toISOString()
  return {
    generated_at: `${iso.slice(0, 19)}+08:00`,
    date: iso.slice(0, 10),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  }
}

// ---------------------------------------------------------------------------
// CLI args（先於任何 I/O 驗證）
// ---------------------------------------------------------------------------

const MODES = ['morning', 'afternoon', 'query'] as const
export type CliMode = (typeof MODES)[number]

export type CliArgs =
  | { mode: 'morning' | 'afternoon'; from?: undefined; to?: undefined }
  | { mode: 'query'; from: string; to: string }

/** parseArgs 專用錯誤——runCli 收到就連埋 usage 一齊寫 stderr。 */
export class CliArgsError extends Error {}

function isMode(value: string): value is CliMode {
  return (MODES as readonly string[]).includes(value)
}

function assertCalendarDate(value: string, flag: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new CliArgsError(`${flag} 格式必須係 YYYY-MM-DD，收到：${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new CliArgsError(`${flag} 唔係真實日曆日：${value}`)
  }
}

function diffCalendarDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  return Math.round((toMs - fromMs) / DAY_MS)
}

/**
 * 解析／驗證 CLI 參數。純函數、零 I/O——任何驗證失敗都 throw（runCli 接住 → exit 1）。
 * 支援 `--mode X` 同 `--mode=X` 兩種寫法。
 */
export function parseArgs(argv: string[]): CliArgs {
  let mode: string | undefined
  let from: string | undefined
  let to: string | undefined
  const seen = new Set<string>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    const eq = arg.indexOf('=')
    const isFlag = arg.startsWith('--')
    const flag = isFlag && eq > 2 ? arg.slice(0, eq) : arg
    const inline = isFlag && eq > 2 ? arg.slice(eq + 1) : undefined
    if (!(flag === '--mode' || flag === '--from' || flag === '--to')) {
      throw new CliArgsError(`唔認得嘅參數：${arg}`)
    }
    if (seen.has(flag)) throw new CliArgsError(`${flag} 重複出現`)
    seen.add(flag)
    const value = inline !== undefined ? inline : argv[++i]
    if (value == null || value === '') throw new CliArgsError(`${flag} 缺少值`)
    if (flag === '--mode') mode = value
    else if (flag === '--from') from = value
    else to = value
  }

  if (mode == null) throw new CliArgsError('缺少 --mode（morning / afternoon / query）')
  if (!isMode(mode)) throw new CliArgsError(`--mode 必須係 morning / afternoon / query，收到：${mode}`)
  if (mode !== 'query' && (from != null || to != null)) {
    throw new CliArgsError('--from / --to 只適用於 query 模式')
  }
  if (mode === 'query') {
    if (from == null || to == null) throw new CliArgsError('query 模式必須同時提供 --from 同 --to（YYYY-MM-DD）')
    assertCalendarDate(from, '--from')
    assertCalendarDate(to, '--to')
    const days = diffCalendarDays(from, to)
    if (days < 0) throw new CliArgsError(`--from（${from}）晚過 --to（${to}）`)
    if (days > MAX_RANGE_DAYS) throw new CliArgsError(`查詢範圍 ${days} 日，超過上限 ${MAX_RANGE_DAYS} 日`)
    return { mode: 'query', from, to }
  }
  return { mode, from: undefined, to: undefined }
}

// ---------------------------------------------------------------------------
// .env parser（手寫，唔用 dotenv）
// ---------------------------------------------------------------------------

/**
 * 極簡 .env parser：strip BOM、trim、跳過空行／`#` 註釋、用**第一個 `=`** 切開
 * （值可以含 `=`）、容 CRLF。r4 m5 補三個 gap：
 * ① 未加引號嘅值 strip 第一個 ` #` 之後嘅 inline 註釋（`A=B # c` → `B`）；
 * ② key 支援 `export ` 前綴（`export K=v` → `K`）；
 * ③ 引號值：取第一對引號之間嘅內容，引號後面（註釋等）一律忽略（`A="x" # c` → `x`）。
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const normalized = text.replace(/^\uFEFF/, '') // strip BOM
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue // 冇 '=' 或空 key → 跳過
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    if (key === '') continue
    let value = line.slice(eq + 1).trim()
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : undefined
    if (quote != null) {
      const close = value.indexOf(quote, 1)
      if (close > 0) {
        out[key] = value.slice(1, close) // 引號內容為準，引號後面（inline 註釋等）忽略
        continue
      }
      // 冇成對引號 → 當未加引號處理
    }
    const comment = value.indexOf(' #')
    if (comment >= 0) value = value.slice(0, comment).trim()
    out[key] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// 同步新鮮度
// ---------------------------------------------------------------------------

/**
 * 兩個同步來源都 `status='ok'` 且 `last_run_at` 距今 ≤26 小時 → 新鮮。
 * 多個問題用 `'; '` 接住一齊報；零行 → 「從未同步」；缺單邊 → 講明邊個缺；
 * `last_run_at` 非 ISO（Date.parse NaN）→ 當 stale（r4 m7：NaN 唔可以判 fresh）。
 * 另輸出 `sources`：逐 key 嘅 `{ key, last_run_at, status }`，DB 原值（r4 m2）。
 */
export function computeSync(rows: MetaRow[], now: Date): SyncStatus {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  if (rows.length === 0 || (!byKey.has(SYNC_KEYS[0]) && !byKey.has(SYNC_KEYS[1]))) {
    return { stale: true, reason: '從未同步', sources: [] }
  }

  const problems: string[] = []
  for (const key of SYNC_KEYS) {
    const row = byKey.get(key)
    if (row == null) {
      problems.push(`缺少 ${key} 同步記錄`)
      continue
    }
    if (row.status !== 'ok') {
      problems.push(
        row.message != null && row.message !== ''
          ? `${key} 同步狀態 ${row.status}：${row.message}`
          : `${key} 同步狀態 ${row.status}`,
      )
      continue
    }
    if (row.last_run_at == null) {
      problems.push(`${key} 從未同步`)
      continue
    }
    const lastRunMs = Date.parse(row.last_run_at)
    if (Number.isNaN(lastRunMs)) {
      problems.push(`${key} 的 last_run_at 格式無效`)
      continue
    }
    const ageHours = (now.getTime() - lastRunMs) / 3_600_000
    if (ageHours > FRESH_HOURS_MAX) {
      problems.push(`${key} 上次同步 ${ageHours.toFixed(1)} 小時前`)
    }
  }

  // r4 m2：sources 照 SYNC_KEYS 序輸出 DB 原值（last_run_at 唔重排格式）；缺行嘅 key 唔出現
  const sources: SyncSource[] = SYNC_KEYS.flatMap((key) => {
    const row = byKey.get(key)
    return row == null ? [] : [{ key: row.key, last_run_at: row.last_run_at, status: row.status }]
  })

  if (problems.length === 0) return { stale: false, reason: null, sources }
  return { stale: true, reason: problems.join('; '), sources }
}

// ---------------------------------------------------------------------------
// 排序、分組、分區（全部記憶體做，唔靠 DB order）
// ---------------------------------------------------------------------------

/** events：is_all_day DESC（全日先）→ start_time ASC → id ASC（tiebreak）。 */
export function compareEvents(a: EventOut, b: EventOut): number {
  return (
    Number(b.is_all_day) - Number(a.is_all_day) ||
    Date.parse(a.start_time) - Date.parse(b.start_time) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/** tasks（row 層面，有 created_at 做 tiebreak）：pinned DESC → due_date ASC（null 最尾）→ created_at ASC。 */
export function compareTasks(a: TaskRow, b: TaskRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.due_date == null || b.due_date == null) {
    if (a.due_date == null && b.due_date == null) return createdAtDelta(a, b)
    return a.due_date == null ? 1 : -1
  }
  if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1 // 'YYYY-MM-DD' 字典序 = 時序
  return createdAtDelta(a, b)
}

function createdAtDelta(a: TaskRow, b: TaskRow): number {
  const aMs = Date.parse(a.created_at)
  const bMs = Date.parse(b.created_at)
  return aMs === bMs ? 0 : aMs < bMs ? -1 : 1
}

const PRIORITY_ORDER: PriorityGroup[] = ['critical', 'high', 'medium', 'low']

function isPriority(value: string): value is PriorityGroup {
  return (PRIORITY_ORDER as string[]).includes(value)
}

function toTaskOut(row: TaskRow, hktToday: string): TaskOut {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    category: row.category,
    due_date: row.due_date,
    pinned: row.pinned,
    overdue: row.due_date != null && row.due_date < hktToday,
  }
}

/** 四級分組（組內先按 comparator 排好）；due_date < 今日(HKT) → overdue。 */
export function groupTasks(rows: TaskRow[], hktToday: string): Record<PriorityGroup, TaskOut[]> {
  const sorted = [...rows].sort(compareTasks)
  const groups: Record<PriorityGroup, TaskOut[]> = { critical: [], high: [], medium: [], low: [] }
  for (const row of sorted) {
    if (!isPriority(row.priority)) continue // DB check constraint 保證唔會發生，防禦性跳過
    groups[row.priority].push(toTaskOut(row, hktToday))
  }
  return groups
}

/** query 模式平面陣列：critical → high → medium → low 組序，組內已按 comparator 排好。 */
export function flattenTaskGroups(groups: Record<PriorityGroup, TaskOut[]>): TaskOut[] {
  return PRIORITY_ORDER.flatMap((group) => groups[group])
}

/** row → 輸出契約 event；relevance 一律由 classifyRelevance 即時計算，唔讀 DB 欄。r4 N3：輸出 title trim。 */
export function toEvent(row: EventRow): EventOut {
  return {
    id: row.id,
    title: row.title.trim(),
    start_time: new Date(row.start_time).toISOString(),
    end_time: new Date(row.end_time).toISOString(),
    is_all_day: row.is_all_day,
    account_key: row.account_key,
    source_calendar: row.source_calendar,
    relevance: classifyRelevance(row.title, row.source_calendar),
  }
}

export interface BriefingBounds {
  /** 明日 00:00 HKT（epoch ms）——today／upcoming 分界。 */
  tomorrowMs: number
  /** 第3日 00:00 HKT——context 嘅上限。 */
  day3Ms: number
  /** 第8日 00:00 HKT——linked 嘅上限。 */
  day8Ms: number
}

/**
 * briefing 分區：
 * - `today` = start < 明日00:00 HKT 嘅**全部行**（含 relevance='noise'，noise 只係唔入 upcoming）；
 * - `upcoming` = linked [明日, +8日) + context [明日, +3日)，noise 剔走，去重後排序。
 *
 * afternoon 模式共用同一函數：拉返嚟嘅行全部 < 明日00:00 → 全入 today、upcoming = []。
 */
export function splitTodayUpcoming(
  rows: EventRow[],
  bounds: BriefingBounds,
): { today: EventOut[]; upcoming: EventOut[] } {
  const today: EventOut[] = []
  const upcoming: EventOut[] = []
  // r4 N1：唔使 seen Set——上游 dedupeEvents 保證 id 唔會重複
  for (const row of rows) {
    const event = toEvent(row)
    const startMs = Date.parse(event.start_time)
    if (startMs < bounds.tomorrowMs) {
      today.push(event)
      continue
    }
    if (event.relevance === 'noise') continue // noise 唔入 upcoming
    const windowEndMs = event.relevance === 'linked' ? bounds.day8Ms : bounds.day3Ms
    if (startMs < windowEndMs) upcoming.push(event)
  }
  today.sort(compareEvents)
  upcoming.sort(compareEvents)
  return { today, upcoming }
}

// ---------------------------------------------------------------------------
// 分頁（Supabase REST server-side max-rows 預設 1000，全表 1,570 行 → 兩頁）
// ---------------------------------------------------------------------------

export interface PageResult<T> {
  rows: T[]
  /** 第一頁帶 `{ count: 'exact' }` 攞到嘅總行數；攞唔到 → null。 */
  count: number | null
}

/**
 * 走勻所有頁。第一頁帶 count → `ceil(count/1000)` 頁；
 * count 攞唔到就 fallback「短頁即停」（回傳 < 1000 行就當完）。
 */
export async function fetchAll<T>(
  fetchPage: (from: number, to: number, withCount: boolean) => Promise<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []
  let last = await fetchPage(0, pageSize - 1, true)
  rows.push(...last.rows)
  if (last.count != null) {
    const pages = Math.ceil(last.count / pageSize)
    for (let page = 1; page < pages; page++) {
      last = await fetchPage(page * pageSize, (page + 1) * pageSize - 1, false)
      rows.push(...last.rows)
    }
    return rows
  }
  while (last.rows.length === pageSize) {
    last = await fetchPage(rows.length, rows.length + pageSize - 1, false)
    rows.push(...last.rows)
  }
  return rows
}

// ---------------------------------------------------------------------------
// runCli（注入式；回傳 exit code，唔叫 process.exit——測試先可以驗「失敗非零 exit」）
// ---------------------------------------------------------------------------

const USAGE =
  '用法：node briefing/fetch.ts --mode morning | afternoon | query [--from YYYY-MM-DD --to YYYY-MM-DD]'

function formatError(err: unknown): string {
  return `錯誤：${err instanceof Error ? err.message : String(err)}`
}

export async function runCli(argv: string[], deps: Deps): Promise<CliResult> {
  try {
    // ① args 驗證先於任何 I/O——失敗連 .env / DB 都未掂過
    const args = parseArgs(argv)
    const now = deps.now()
    const nowParts = hktNowParts(now)

    if (args.mode === 'query') {
      const [fromIso, toIso] = hktQueryWindow(args.from, args.to)
      const [eventRows, taskRows, metaRows] = await Promise.all([
        deps.queryEvents(fromIso, toIso),
        deps.queryTasks(),
        deps.querySystemMeta(SYNC_KEYS),
      ])
      const payload: QueryPayload = {
        generated_at: nowParts.generated_at,
        range: { from: args.from, to: args.to },
        sync: computeSync(metaRows, now),
        events: dedupeEvents(eventRows).map(toEvent).sort(compareEvents),
        tasks: flattenTaskGroups(groupTasks(taskRows, nowParts.date)),
      }
      return { exitCode: 0, stdout: JSON.stringify(payload, null, 2), stderr: '' }
    }

    // briefing 模式（morning / afternoon）
    // r4 m9：用返 hktTomorrowStartUtc（唔好手算 +1日），令個 export 有 production 使用者
    const tomorrowDate = hktDateStr(hktTomorrowStartUtc(now))
    const [fromIso, toIso] =
      args.mode === 'morning' ? hktMorningWindow(nowParts.date) : hktAfternoonWindow(nowParts.date)
    // r4 M2：afternoon 包全日事件——all-day 專屬下界 = 今日 00:00 HKT（spec「Afternoon 模式窗口」）
    const allDayFromIso = args.mode === 'afternoon' ? hktTodayStartUtc(now).toISOString() : null
    const upcomingWindows = hktUpcomingWindows(nowParts.date)
    const [eventRows, taskRows, metaRows, cycleRows] = await Promise.all([
      deps.queryEvents(fromIso, toIso, allDayFromIso),
      deps.queryTasks(),
      deps.querySystemMeta(SYNC_KEYS),
      deps.queryCycleDays([nowParts.date, tomorrowDate]),
    ])
    const bounds: BriefingBounds = {
      tomorrowMs: Date.parse(upcomingWindows.linked[0]),
      day3Ms: Date.parse(upcomingWindows.context[1]),
      day8Ms: Date.parse(upcomingWindows.linked[1]),
    }
    const { today, upcoming } = splitTodayUpcoming(dedupeEvents(eventRows), bounds)
    const cycleByDate = new Map(cycleRows.map((row) => [row.date, row.day_label]))
    const payload: BriefingPayload = {
      generated_at: nowParts.generated_at,
      date: nowParts.date,
      weekday: nowParts.weekday,
      sync: computeSync(metaRows, now),
      cycle: {
        today: cycleByDate.get(nowParts.date) ?? null,
        tomorrow: cycleByDate.get(tomorrowDate) ?? null,
      },
      today,
      upcoming,
      tasks: groupTasks(taskRows, nowParts.date),
    }
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2), stderr: '' }
  } catch (err) {
    // stdout 紀律：任何失敗都唔可以有部分 JSON 出街——stdout 一律空串
    const message = formatError(err)
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof CliArgsError ? `${message}\n${USAGE}` : message,
    }
  }
}

// ---------------------------------------------------------------------------
// 真 deps（CLI 接線）——lazy 初始化：parseArgs 過咗先會掂 .env / DB
// ---------------------------------------------------------------------------

type Supabase = ReturnType<typeof createClient>

const EVENT_COLUMNS = 'id,title,start_time,end_time,is_all_day,account_key,source_calendar'
const TASK_COLUMNS = 'id,title,priority,category,due_date,pinned,created_at'

function toRows<T>(data: T[] | null, error: { message: string } | null, what: string): T[] {
  if (error) throw new Error(`${what} 查詢失敗：${error.message}`)
  return data ?? []
}

/**
 * events 分頁查詢（export 俾測試記錄 query chain）。
 * `allDayFromIso` 有值（afternoon）→ 全日事件唔受 `fromIso`（13:00）下界限制：
 * `start_time < toIso AND start_time >= allDayFromIso AND (start_time >= fromIso OR is_all_day)`
 * （spec「Afternoon 模式窗口」；mirror 保留過去 1 日，all-day 冇下界會連尋日嘅假期都拉埋入 today）。
 */
export async function fetchEvents(
  client: Supabase,
  fromIso: string,
  toIso: string,
  allDayFromIso: string | null = null,
): Promise<EventRow[]> {
  return fetchAll(async (from, to, withCount) => {
    let query = client
      .from('events')
      .select(EVENT_COLUMNS, withCount ? { count: 'exact' as const } : undefined)
      .is('cancelled_at', null)
      .lt('start_time', toIso)
      .gte('start_time', allDayFromIso ?? fromIso)
      // r4 M1：分頁兩頁係獨立 statement，冇 ORDER BY 會漏行／重複
      .order('start_time', { ascending: true })
      .order('id')
    if (allDayFromIso != null) {
      query = query.or(`start_time.gte.${fromIso},is_all_day.eq.true`)
    }
    const { data, error, count } = await query.range(from, to)
    return { rows: toRows(data as EventRow[] | null, error, 'events'), count: count ?? null }
  })
}

export async function fetchTasks(client: Supabase): Promise<TaskRow[]> {
  return fetchAll(async (from, to, withCount) => {
    const query = client
      .from('tasks')
      .select(TASK_COLUMNS, withCount ? { count: 'exact' as const } : undefined)
      .eq('status', 'todo')
      .is('deleted_at', null)
      // r4 M1：分頁兩頁係獨立 statement，冇 ORDER BY 會漏行／重複
      .order('id')
      .range(from, to)
    const { data, error, count } = await query
    return { rows: toRows(data as TaskRow[] | null, error, 'tasks'), count: count ?? null }
  })
}

async function fetchCycleDays(client: Supabase, dates: string[]): Promise<CycleRow[]> {
  const { data, error } = await client.from('cycle_days').select('date,day_label').in('date', dates)
  return toRows(data as CycleRow[] | null, error, 'cycle_days')
}

async function fetchSystemMeta(client: Supabase, keys: string[]): Promise<MetaRow[]> {
  const { data, error } = await client.from('system_meta').select('key,last_run_at,status,message').in('key', keys)
  return toRows(data as MetaRow[] | null, error, 'system_meta')
}

function readEnvFile(): Record<string, string> {
  // 用模組自身位置定位 repo root 嘅 .env，唔靠 CWD
  const envUrl = new URL('../.env', import.meta.url)
  let text: string
  try {
    text = readFileSync(envUrl, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {} // 冇 .env → 當空，靠 process.env
    throw err
  }
  return parseDotEnv(text)
}

/**
 * env 讀取（fileEnv／processEnv 可注入以便測試）：process.env 優先（CI／GitHub Actions 情境）。
 * r4 m6：空字串當未設定——用 `||` 而非 `??`，`''` 一樣 fallback 到 .env。
 */
export function resolveEnv(
  fileEnv: Record<string, string> = readEnvFile(),
  processEnv: Record<string, string | undefined> = process.env,
): { url: string; key: string } {
  const url = processEnv.VITE_SUPABASE_URL || fileEnv['VITE_SUPABASE_URL']
  const key = processEnv.SUPABASE_SERVICE_ROLE_KEY || fileEnv['SUPABASE_SERVICE_ROLE_KEY']
  if (!url) throw new Error('缺少 VITE_SUPABASE_URL（process.env 或 repo root .env）')
  if (!key) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY（process.env 或 repo root .env）')
  return { url, key }
}

/** 真 deps：client 第一次用到先建（resolveEnv + createClient），建構 Deps 物件本身零 I/O。 */
export function createRealDeps(): Deps {
  let clientPromise: Promise<Supabase> | null = null
  const getClient = (): Promise<Supabase> => {
    clientPromise ??= (async () => {
      const { url, key } = resolveEnv()
      return createClient(url, key, { auth: { persistSession: false } })
    })()
    return clientPromise
  }
  return {
    now: () => new Date(),
    queryEvents: (fromIso, toIso, allDayFromIso) =>
      getClient().then((client) => fetchEvents(client, fromIso, toIso, allDayFromIso ?? null)),
    queryTasks: () => getClient().then((client) => fetchTasks(client)),
    queryCycleDays: (dates) => getClient().then((client) => fetchCycleDays(client, dates)),
    querySystemMeta: (keys) => getClient().then((client) => fetchSystemMeta(client, keys)),
  }
}

// ---------------------------------------------------------------------------
// main + direct-run guard
// ---------------------------------------------------------------------------

function main(): void {
  runCli(process.argv.slice(2), createRealDeps())
    .then((result) => {
      // r4 m4：exitCode 而非 process.exit()——stdout 接 pipe 時 exit() 會截斷輸出
      console.log(result.stdout)
      if (result.stderr) console.error(result.stderr)
      process.exitCode = result.exitCode
    })
    .catch((err) => {
      // runCli 已包住所有預期失敗；呢度係防禦網（例如 deps 建構本身爆）
      console.error(formatError(err))
      process.exitCode = 1
    })
}

// direct-run guard：`node briefing/fetch.ts …` 先行 main()；被 import（如 vitest）唔會觸發。
const entry = process.argv[1]
if (entry != null && import.meta.url === pathToFileURL(entry).href) {
  main()
}
