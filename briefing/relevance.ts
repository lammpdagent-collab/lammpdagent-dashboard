// ---------------------------------------------------------------------------
// relevance 分類（add-daily-briefing / r2 plan Step 3）
// 規則順序：① 校曆循環日標題 → noise；② keyword 命中 → linked；③ 其餘 → context
// ---------------------------------------------------------------------------

export type Relevance = 'linked' | 'context' | 'noise'

/** 校曆循環日標題：`Day` 前綴 case-sensitive，字母全形／半形皆計，`Day` 同字母之間零至多個空格都得。 */
export const DAY_TITLE_RE = /^Day\s*[A-FＡ-Ｆ]/

/** 命中任一 keyword → linked。比對時 haystack 同 keyword 都先 toLowerCase（大小寫不敏感，中文不受影響）。 */
export const RELEVANCE_KEYWORDS = [
  '民', 'Dickson', '林民平', 'Lam Man Ping',
  '課程主任', 'PSMCD',
  '學教', '常識', '人文', '科學', '國安', '國家安全',
  '觀課',   // 2026-11-28：觀課唔應因科目名唔同而跌出 7 日窗
] as const

/**
 * 分類一個日曆事件標題嘅相關度。純函數，零 I/O。
 *
 * @param sourceCalendar 來源曆 key。參數保留但冇任何規則消費——「personal → linked」已否決，
 *                       純粹維持對外 API 形狀，留俾日後擴充。
 */
export function classifyRelevance(
  title: string,
  sourceCalendar: string | null,
): Relevance {
  // r4 N5：先 trim——' Day A'（前有空格）唔可以因為空白就避開 Day 規則
  const trimmed = title.trim()

  // ① Day 規則優先過 keyword：'Day A 民安左右' 都係 noise
  if (DAY_TITLE_RE.test(trimmed)) return 'noise'

  // ② keyword 比對（雙方 lowercase 後 includes）
  const haystack = trimmed.toLowerCase()
  if (RELEVANCE_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
    return 'linked'
  }

  // ③ 其餘 → context
  return 'context'
}
