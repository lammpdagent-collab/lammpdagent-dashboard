/**
 * Resync 節流策略（m6 / N2 / N9）——由 main.ts resyncWhenIdle 抽出嘅純判斷，
 * 補單元測試（N9）。唔碰 DOM、唔碰 store、唔碰 supabase。
 */

/**
 * resync（全量 reload）可唔可以即刻行：
 * - 冇 in-flight 寫入 → 立即 resync；
 * - 有 in-flight 寫入 → 原則上延後（resync 唔可以同樂觀寫入賽跑，m6）；
 * - 但最舊一筆寫入若已 pending 超過 staleMs（疑似請求卡死，永遠唔會
 *   resolve），唔可以永久鎖死 resync——照樣放行（N2），賽跑風險由
 *   realtime echo merge 同 loadAll 嘅 N1 計數檢查補返。
 *
 * @param pendingCount 目前 in-flight 寫入數
 * @param oldestPendingAt 最舊一筆寫入嘅開始時間（null = 冇記錄，保守延後）
 * @param now 現在時間（ms epoch；測試注入用）
 * @param staleMs pending 超過咁耐就當疑似卡死
 * @returns true = 立即 resync；false = 延後（呼叫方記低 deferred，等歸零再做）
 */
export function shouldResyncNow(
  pendingCount: number,
  oldestPendingAt: number | null,
  now: number,
  staleMs: number,
): boolean {
  if (pendingCount <= 0) return true
  if (oldestPendingAt === null) return false
  return now - oldestPendingAt >= staleMs
}
