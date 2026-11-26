/**
 * 時間工具 —— 全部純函式，固定 Asia/Hong_Kong = UTC+8。
 * HK 自 1979 年起無 DST、恆為 +8；本 app 只處理現在／未來日期 ⇒ 固定 offset 安全
 * （歷史日期先需要 Intl 計 offset，唔適用）。刻意唔用 Intl.DateTimeFormat：
 * Node/browser ICU 版本差異會令 weekday 等結果唔穩；getUTC* + 固定 offset 完全確定。
 */

/** 固定 HK offset（ms）＝ +8 小時。 */
export const HK_OFFSET_MS = 8 * 60 * 60 * 1000

/** 一日長度（ms）。HK 無 DST，每日恆為 24 小時。 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 0 = 星期日 … 6 = 星期六，對應 getUTCDay()。 */
export const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const

/** HK 牆上鐘各部分；weekday 為 0–6（0 = 日），作 WEEKDAY_ZH index。 */
export interface HkParts {
  year: number
  /** 1–12 */
  month: number
  /** 1–31 */
  day: number
  hour: number
  minute: number
  /** 0–6，0 = 星期日 */
  weekday: number
}

const DATE_STR_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDateStr(dateStr: string): { y: number; m: number; d: number } {
  const match = DATE_STR_RE.exec(dateStr)
  if (match === null) {
    throw new RangeError(`invalid date string: "${dateStr}" (expected YYYY-MM-DD)`)
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** epoch ms → HK 各部分。做法：+8h 後全部用 getUTC* 取。 */
export function toHkParts(epochMs: number): HkParts {
  const shifted = new Date(epochMs + HK_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  }
}

/** HK 今日日期字串，例如 '2026-11-27'。 */
export function hkTodayDateString(now: number = Date.now()): string {
  const p = toHkParts(now)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** 'YYYY-MM-DD' → HK 當日 00:00 嘅 absolute epoch ms。 */
export function hkDayStartEpoch(dateStr: string): number {
  const { y, m, d } = parseDateStr(dateStr)
  return Date.UTC(y, m - 1, d) - HK_OFFSET_MS
}

/** 日曆日加減 n 日（經 UTC 日曆運算；跨月／跨年正確）。 */
export function addDays(dateStr: string, n: number): string {
  const { y, m, d } = parseDateStr(dateStr)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** epoch ms → 'HH:MM'（24 小時制，HK 時區）。 */
export function formatHm(epochMs: number): string {
  const p = toHkParts(epochMs)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/** 'YYYY-MM-DD' → 'DD/MM'。 */
export function formatDdMm(dateStr: string): string {
  const { m, d } = parseDateStr(dateStr)
  return `${pad2(d)}/${pad2(m)}`
}

/**
 * 分組標題：`今日 26/11（三）`。prefix 為空字串（Upcoming 逐日小標題）時
 * 出 `26/11（三）`，唔會有前導空格。
 */
export function formatGroupTitle(prefix: string, dateStr: string): string {
  const { y, m, d } = parseDateStr(dateStr)
  const weekday = WEEKDAY_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const head = prefix === '' ? '' : `${prefix} `
  return `${head}${formatDdMm(dateStr)}（${weekday}）`
}

/** '10:10 – 11:55'（en dash 兩側空格）。 */
export function formatRange(startMs: number, endMs: number): string {
  return `${formatHm(startMs)} – ${formatHm(endMs)}`
}
