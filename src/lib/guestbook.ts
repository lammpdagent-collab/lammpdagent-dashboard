/**
 * 訪客留言板純邏輯 —— 唔碰 DOM、唔碰網絡，方便 unit test。
 */

/** 暱稱長度上限（code point）。 */
export const MAX_NAME_LEN = 30

/** 內容長度上限（code point）。 */
export const MAX_MESSAGE_LEN = 500

/** 計 Unicode code point 長度（唔係 UTF-16 unit，emoji 算 1）；純計數，唔 trim。 */
export function codePointLength(value: string): number {
  return [...value].length
}

/**
 * 首尾「空白 + zero-width」字元集，同 `VISUALLY_BLANK_RE`／DB `btrim` constraint
 * 嘅字元集對齊（migration 20261124165938）。JS `trim()` 唔會移除 zero-width 字元
 * ——U+180E（MVS）、U+200B（ZWSP）、U+200C（ZWNJ）、U+200D（ZWJ）、U+2060（WORD JOINER）
 * ——唔清走嘅話，DB `name = btrim(name, …)` 會拒收，用戶只見「提交失敗」。
 */
const EDGE_INVISIBLE_RE =
  /^[\s\u180e\u200b\u200c\u200d\u2060\ufeff]+|[\s\u180e\u200b\u200c\u200d\u2060\ufeff]+$/g

/** 移除首尾空白 + zero-width 字元；`g` flag 一次 replace 已處理首尾，do-while 保險清到長度穩定。 */
function trimInvisible(value: string): string {
  let out = value
  let prev: string
  do {
    prev = out
    out = out.replace(EDGE_INVISIBLE_RE, '')
  } while (out !== prev)
  return out
}

/**
 * 視覺空白判定（雙重保險）：理論上 `trimInvisible` 之後非空字串首尾一定唔係
 * 呢啲字元，唔會再中呢條 regex；留返做防線，確保純空白／zero-width 輸入被拒。
 */
const VISUALLY_BLANK_RE = /^[\s\u180e\u200b\u200c\u200d\u2060\ufeff]*$/

/** 驗證結果：成功時帶已 trim 嘅欄位（儲存用），失敗時帶逐欄位錯誤訊息。 */
export type ValidationResult =
  | { ok: true; name: string; message: string }
  | { ok: false; errors: { name?: string; message?: string } }

/** 清走兩個欄位首尾空白 + zero-width 後驗證長度；失敗時回逐欄位訊息，唔拋錯。 */
export function validateMessage(rawName: string, rawMessage: string): ValidationResult {
  const name = trimInvisible(rawName)
  const message = trimInvisible(rawMessage)
  const errors: { name?: string; message?: string } = {}

  const nameLen = codePointLength(name)
  if (nameLen === 0 || VISUALLY_BLANK_RE.test(name)) {
    errors.name = '暱稱唔可以空白'
  } else if (nameLen > MAX_NAME_LEN) {
    errors.name = `暱稱最長 ${MAX_NAME_LEN} 個字`
  }

  const messageLen = codePointLength(message)
  if (messageLen === 0 || VISUALLY_BLANK_RE.test(message)) {
    errors.message = '內容唔可以空白'
  } else if (messageLen > MAX_MESSAGE_LEN) {
    errors.message = `內容最長 ${MAX_MESSAGE_LEN} 個字`
  }

  if (errors.name !== undefined || errors.message !== undefined) {
    return { ok: false, errors }
  }
  return { ok: true, name, message }
}

/** 固定以香港時間顯示建立時間（design D6）。 */
export function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** DB `messages` row 形狀（未生成 `src/types/db.ts`，暫時手寫）。 */
export interface RawMessageRow {
  id: number
  name: string
  message: string
  created_at: string
}

/** UI 用嘅留言 entry（時間已轉 Date）。 */
export interface MessageEntry {
  id: number
  name: string
  message: string
  createdAt: Date
}

/** DB row → UI entry；缺欄或 `created_at` 唔合法就回 null（render 時濾走）。 */
export function normaliseRow(
  row: Partial<RawMessageRow> | null | undefined,
): MessageEntry | null {
  if (row === null || typeof row !== 'object') return null
  const { id, name, message, created_at } = row
  if (typeof id !== 'number' || typeof name !== 'string' || typeof message !== 'string') {
    return null
  }
  if (typeof created_at !== 'string') return null
  const createdAt = new Date(created_at)
  if (Number.isNaN(createdAt.getTime())) return null
  return { id, name, message, createdAt }
}
