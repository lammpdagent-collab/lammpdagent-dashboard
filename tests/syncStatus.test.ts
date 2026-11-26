import { describe, expect, it } from 'vitest'
import { syncWarnings } from '../src/lib/syncStatus'
import type { SystemMetaRow } from '../src/lib/types'

// 基準：HK 2026-11-27（五）12:00
const NOW = Date.UTC(2026, 10, 27, 4, 0, 0)
const HOUR = 60 * 60 * 1000

function meta(key: string, status: string, ageMs: number, message: string | null = null): SystemMetaRow {
  return {
    key,
    status,
    last_run_at: new Date(NOW - ageMs).toISOString(),
    message,
    detail: null,
  }
}

const ok = (ageMs: number) => meta('calendar_sync:personal', 'ok', ageMs)
const work = (status: string, ageMs: number) => meta('calendar_sync:work', status, ageMs)

describe('syncWarnings（R1-3）', () => {
  it('ok 且 1 小時內 → 唔告警（一切正常完全不顯示）', () => {
    expect(syncWarnings([ok(1 * HOUR), work('ok', 1 * HOUR)], NOW)).toEqual([])
  })

  it('init 且 1 小時內 → 唔告警（首次部署唔告警）', () => {
    expect(syncWarnings([ok(1 * HOUR), work('init', 1 * HOUR)], NOW)).toEqual([])
  })

  it('error 不論幾耐 → 「更新失敗」（5 分鐘前都出）', () => {
    const rows = [ok(1 * HOUR), work('error', 5 * 60 * 1000)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆更新失敗' },
    ])
  })

  it('error 30 小時 → 只出「更新失敗」一條（唔重覆出小時警告）', () => {
    const rows = [meta('calendar_sync:personal', 'error', 30 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆更新失敗' },
      { source: 'work', text: '⚠️ 學校日曆未有同步記錄' },
    ])
  })

  it('stale 而 last_run 只過 2 小時 → 仍然告警「同步停滯」', () => {
    const rows = [ok(1 * HOUR), work('stale', 2 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆同步停滯' },
    ])
  })

  it('stale 30 小時 → 只出「同步停滯」', () => {
    const rows = [ok(1 * HOUR), work('stale', 30 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆同步停滯' },
    ])
  })

  it('last_run_at 26 小時前（ok）→ 「26 小時未更新」', () => {
    const rows = [ok(1 * HOUR), work('ok', 26 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆 26 小時未更新' },
    ])
  })

  it('init 但 25 小時前 → 照出小時警告（24h 規則不論 ok/init）', () => {
    const rows = [ok(1 * HOUR), work('init', 25 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆 25 小時未更新' },
    ])
  })

  it('剛好 24 小時（含下界）→ 告警 N=24；23 小時唔告警', () => {
    expect(syncWarnings([ok(24 * HOUR), work('ok', 1 * HOUR)], NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆 24 小時未更新' },
    ])
    expect(syncWarnings([ok(23 * HOUR), work('ok', 1 * HOUR)], NOW)).toEqual([])
  })

  it('N = floor 小時數（26.5h → 26）', () => {
    const rows = [ok(26.5 * HOUR), work('ok', 1 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆 26 小時未更新' },
    ])
  })

  it('key 缺行 → 「未有同步記錄」（personal 有行，work 缺）', () => {
    const rows = [ok(1 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'work', text: '⚠️ 學校日曆未有同步記錄' },
    ])
  })

  it('完全無行 → 兩來源都「未有同步記錄」', () => {
    expect(syncWarnings([], NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆未有同步記錄' },
      { source: 'work', text: '⚠️ 學校日曆未有同步記錄' },
    ])
  })

  it('兩來源各有問題：順序固定 personal 先', () => {
    const rows = [work('error', 1 * HOUR), meta('calendar_sync:personal', 'stale', 3 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆同步停滯' },
      { source: 'work', text: '⚠️ 學校日曆更新失敗' },
    ])
  })

  it('同時 error 又超 24h：error 優先，每來源最多一條', () => {
    const rows = [meta('calendar_sync:personal', 'error', 48 * HOUR), work('ok', 1 * HOUR)]
    expect(syncWarnings(rows, NOW)).toEqual([
      { source: 'personal', text: '⚠️ 私人日曆更新失敗' },
    ])
  })
})
