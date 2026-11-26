/**
 * 同步狀態警告判定（R1-3）—— 純函式；main.ts 只負責 render 警告列。
 *
 * 每個來源最多一條警告，按嚴重程度優先：
 *   1. key 缺行            → 「⚠️ {label}未有同步記錄」（規格未明定，第二輪拍板接受）
 *   2. status='error'      → 「⚠️ {label}更新失敗」（不論距離幾耐）
 *   3. status='stale'      → 「⚠️ {label}同步停滯」（就算 2 小時都出）
 *   4. last_run_at ≥ 24h 前 → 「⚠️ {label} N 小時未更新」（N = floor 小時；不論 ok/init）
 *   5. ok/init 且 < 24h     → 唔出（init 24 小時內唔告警）
 * 正常時（兩來源都 ok/init 且 <24h）回空陣列 ⇒ 完全唔顯示同步資訊。
 */
import type { SyncSource, SyncWarning, SystemMetaRow } from './types'

/** 超過幾耐算過期（「超過 24 小時時提示資料可能過期」）。 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** 前端預期嘅同步來源 key（calendar-events / sync-status spec）。 */
export const EXPECTED_SYNC_KEYS = ['calendar_sync:personal', 'calendar_sync:work'] as const

const KEY_PREFIX = 'calendar_sync:'

/** `calendar_sync:personal` → 私人日曆、`calendar_sync:work` → 學校日曆。 */
export const SYNC_SOURCE_LABELS: Record<SyncSource, string> = {
  personal: '私人日曆',
  work: '學校日曆',
}

function labelOf(key: string): { source: SyncSource; label: string } {
  const source = key.slice(KEY_PREFIX.length) as SyncSource
  return { source, label: SYNC_SOURCE_LABELS[source] }
}

function warningForRow(row: SystemMetaRow, now: number): SyncWarning | null {
  const { source, label } = labelOf(row.key)
  if (row.status === 'error') {
    return { source, text: `⚠️ ${label}更新失敗` }
  }
  if (row.status === 'stale') {
    return { source, text: `⚠️ ${label}同步停滯` }
  }
  const ageMs = now - Date.parse(row.last_run_at)
  if (ageMs >= STALE_AFTER_MS) {
    const hours = Math.floor(ageMs / (60 * 60 * 1000))
    return { source, text: `⚠️ ${label} ${hours} 小時未更新` }
  }
  return null // ok / init（或其他未知值）且 <24h → 唔告警
}

/**
 * 由 system_meta rows 計警告清單。輸出順序固定：personal 先、work 後
 * （EXPECTED_SYNC_KEYS 順序），每個來源最多一條。
 */
export function syncWarnings(rows: readonly SystemMetaRow[], now: number): SyncWarning[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const warnings: SyncWarning[] = []
  for (const key of EXPECTED_SYNC_KEYS) {
    const row = byKey.get(key)
    if (row === undefined) {
      const { source, label } = labelOf(key)
      warnings.push({ source, text: `⚠️ ${label}未有同步記錄` })
      continue
    }
    const warning = warningForRow(row, now)
    if (warning !== null) warnings.push(warning)
  }
  return warnings
}
