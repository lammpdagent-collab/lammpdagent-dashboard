import { describe, expect, it } from 'vitest'
import {
  HK_OFFSET_MS,
  MS_PER_DAY,
  WEEKDAY_ZH,
  addDays,
  formatDdMm,
  formatGroupTitle,
  formatHm,
  formatRange,
  hkDayStartEpoch,
  hkTodayDateString,
  toHkParts,
} from '../src/lib/time'

// 測試基準：2026-11-27 係星期五（HK）。以下 epoch 都用 UTC 表達。
const HK_NOON_1127 = Date.UTC(2026, 10, 27, 4, 0, 0) // HK 2026-11-27 12:00
const HK_MIDNIGHT_1127 = Date.UTC(2026, 10, 26, 16, 0, 0) // 2026-11-27T00:00+08:00

describe('toHkParts', () => {
  it('UTC 02:10Z → HK 10:10（裝置時區非香港 scenario）', () => {
    const p = toHkParts(Date.UTC(2026, 10, 27, 2, 10))
    expect(p).toEqual({ year: 2026, month: 11, day: 27, hour: 10, minute: 10, weekday: 5 })
  })

  it('HK 00:00 邊界：2026-11-26T16:00:00.000Z = HK 11-27 00:00 星期五', () => {
    const p = toHkParts(HK_MIDNIGHT_1127)
    expect(p).toEqual({ year: 2026, month: 11, day: 27, hour: 0, minute: 0, weekday: 5 })
  })

  it('HK 邊界前 1ms 仍屬前一日 23:59 星期四', () => {
    const p = toHkParts(HK_MIDNIGHT_1127 - 1)
    expect(p).toEqual({ year: 2026, month: 11, day: 26, hour: 23, minute: 59, weekday: 4 })
  })
})

describe('hkTodayDateString', () => {
  it('HK 正午 → 當日', () => {
    expect(hkTodayDateString(HK_NOON_1127)).toBe('2026-11-27')
  })

  it('UTC 15:59:59.999 仍係 HK 前一日', () => {
    expect(hkTodayDateString(Date.UTC(2026, 10, 26, 15, 59, 59, 999))).toBe('2026-11-26')
  })

  it('UTC 16:00:00.000 已係 HK 翌日', () => {
    expect(hkTodayDateString(HK_MIDNIGHT_1127)).toBe('2026-11-27')
  })
})

describe('hkDayStartEpoch', () => {
  it('回 HK 當日 00:00 嘅 absolute epoch（= 2026-11-26T16:00Z）', () => {
    expect(hkDayStartEpoch('2026-11-27')).toBe(HK_MIDNIGHT_1127)
  })

  it('該 epoch 之 HK 時間為 00:00、日期字串原樣', () => {
    expect(hkTodayDateString(hkDayStartEpoch('2026-11-27'))).toBe('2026-11-27')
    expect(formatHm(hkDayStartEpoch('2026-11-27'))).toBe('00:00')
  })

  it('非法格式拋錯', () => {
    expect(() => hkDayStartEpoch('2026/11/27')).toThrow(RangeError)
    expect(() => hkDayStartEpoch('garbage')).toThrow(RangeError)
  })
})

describe('addDays', () => {
  it('窗口末端：11-27 + 7 日 = 12-04', () => {
    expect(addDays('2026-11-27', 7)).toBe('2026-12-04')
  })

  it('跨月', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
  })

  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('負數倒退跨月', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('0 日原樣', () => {
    expect(addDays('2026-11-27', 0)).toBe('2026-11-27')
  })

  it('非法格式拋錯', () => {
    expect(() => addDays('2026-1-3', 1)).toThrow(RangeError)
  })
})

describe('formatHm', () => {
  it('24 小時制補零', () => {
    expect(formatHm(Date.UTC(2026, 10, 27, 2, 10))).toBe('10:10')
    expect(formatHm(HK_NOON_1127)).toBe('12:00')
    expect(formatHm(Date.UTC(2026, 10, 26, 16, 5))).toBe('00:05')
  })
})

describe('formatDdMm', () => {
  it('DD/MM 補零', () => {
    expect(formatDdMm('2026-11-27')).toBe('27/11')
    expect(formatDdMm('2026-01-05')).toBe('05/01')
  })
})

describe('formatGroupTitle', () => {
  it('今日標題帶星期（2026-11-27 = 五）', () => {
    expect(formatGroupTitle('今日', '2026-11-27')).toBe('今日 27/11（五）')
  })

  it('26/11（四）weekday 對應 + 聽日', () => {
    expect(formatGroupTitle('今日', '2026-11-26')).toBe('今日 26/11（四）')
    expect(formatGroupTitle('聽日', '2026-11-28')).toBe('聽日 28/11（六）')
  })

  it('Upcoming 逐日小標題：無 prefix 出 DD/MM（星期）', () => {
    expect(formatGroupTitle('', '2026-11-29')).toBe('29/11（日）')
    expect(formatGroupTitle('', '2026-12-01')).toBe('01/12（二）')
  })
})

describe('formatRange', () => {
  it('en dash 兩側空格', () => {
    expect(formatRange(Date.UTC(2026, 10, 27, 2, 10), Date.UTC(2026, 10, 27, 3, 55))).toBe(
      '10:10 – 11:55',
    )
  })
})

describe('常數', () => {
  it('HK offset = 8 小時、一日 = 24 小時、weekday 表完整', () => {
    expect(HK_OFFSET_MS).toBe(8 * 60 * 60 * 1000)
    expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000)
    expect([...WEEKDAY_ZH]).toEqual(['日', '一', '二', '三', '四', '五', '六'])
  })
})
