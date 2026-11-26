import { describe, expect, it } from 'vitest'
import { shouldResyncNow } from '../src/lib/resync'

// N9：m6／N2 嘅 resync 節流判斷——原本喺 main.ts resyncWhenIdle 內，抽到 lib 補測試。
const NOW = 1_800_000_000_000
const STALE_MS = 15_000

describe('shouldResyncNow（N2/N9）', () => {
  it('pending = 0 → 立即 resync（oldestPendingAt 唔理係乜）', () => {
    expect(shouldResyncNow(0, null, NOW, STALE_MS)).toBe(true)
    expect(shouldResyncNow(0, NOW - 1, NOW, STALE_MS)).toBe(true)
  })

  it('pending > 0 但仍在 stale 時限內 → 延後（唔 resync，等寫入歸零）', () => {
    expect(shouldResyncNow(1, NOW - 1, NOW, STALE_MS)).toBe(false)
    expect(shouldResyncNow(2, NOW - STALE_MS + 1, NOW, STALE_MS)).toBe(false)
  })

  it('pending > 0 且超過 stale 時限 → 照 resync（疑似卡死，唔好永久鎖死）', () => {
    expect(shouldResyncNow(1, NOW - STALE_MS, NOW, STALE_MS)).toBe(true) // 剛好到界（>=）
    expect(shouldResyncNow(3, NOW - STALE_MS - 1, NOW, STALE_MS)).toBe(true)
  })

  it('pending > 0 但 oldestPendingAt = null（冇記錄）→ 保守延後', () => {
    expect(shouldResyncNow(1, null, NOW, STALE_MS)).toBe(false)
  })
})
