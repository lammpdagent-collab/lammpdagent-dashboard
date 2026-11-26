import { describe, expect, it } from 'vitest'
import {
  buildEventWindow,
  eventState,
  filterClones,
  groupEvents,
  sortWithinDay,
} from '../src/lib/eventQuery'
import type { EventRow } from '../src/lib/types'

// 基準：HK 2026-11-27（五）12:00
const NOW = Date.UTC(2026, 10, 27, 4, 0, 0)
const S0 = Date.UTC(2026, 10, 26, 16, 0, 0) // HK 今日 00:00
const S7 = S0 + 7 * 24 * 60 * 60 * 1000 // HK 今日+7日 00:00 = 2026-12-03T16:00Z
const HOUR = 60 * 60 * 1000

let seq = 0
function event(overrides: Partial<EventRow> = {}): EventRow {
  seq += 1
  return {
    id: `e${seq}`,
    account_key: 'personal',
    calendar_status: 'confirmed',
    cancelled_at: null,
    day_cycle: null,
    description: '',
    end_time: '2026-11-27T05:00:00.000Z', // HK 13:00
    google_event_id: `g${seq}`,
    is_all_day: false,
    last_synced_at: '2026-11-27T01:00:00.000Z',
    location: '',
    recurrence_note: null,
    relevance: 'context',
    series_id: null,
    source_calendar: null,
    start_time: '2026-11-27T04:00:00.000Z', // HK 12:00
    title: `事件 ${seq}`,
    ...overrides,
  }
}

describe('buildEventWindow', () => {
  it('窗口 = [HK今日00:00, HK+7日00:00)，ISO Z 字串', () => {
    expect(buildEventWindow(NOW)).toEqual({
      startIso: '2026-11-26T16:00:00.000Z',
      endIso: '2026-12-03T16:00:00.000Z',
    })
  })

  it('窗口長度恰為 7 日；字串無 + 號（PostgREST filter 安全）', () => {
    const w = buildEventWindow(NOW)
    expect(Date.parse(w.endIso) - Date.parse(w.startIso)).toBe(7 * 24 * HOUR)
    expect(w.startIso).not.toContain('+')
    expect(w.endIso).not.toContain('+')
  })
})

describe('filterClones（R1-7）', () => {
  it('1 分鐘差同標題 → personal 副本濾走，work 保留', () => {
    const work = event({
      account_key: 'work',
      title: '全級會議',
      start_time: '2026-11-27T01:00:00.000Z',
      end_time: '2026-11-27T02:00:00.000Z',
    })
    const personal = event({
      account_key: 'personal',
      title: '全級會議',
      start_time: '2026-11-27T01:01:00.000Z',
      end_time: '2026-11-27T02:01:00.000Z',
    })
    const result = filterClones([work, personal])
    expect(result).toEqual([work])
  })

  it('6 分鐘差 → 唔濾（寧可多一行）', () => {
    const work = event({
      account_key: 'work',
      title: '全級會議',
      start_time: '2026-11-27T01:00:00.000Z',
    })
    const personal = event({
      account_key: 'personal',
      title: '全級會議',
      start_time: '2026-11-27T01:06:00.000Z',
    })
    expect(filterClones([work, personal])).toEqual([work, personal])
  })

  it('標題不同（trim 後）→ 唔濾', () => {
    const work = event({ account_key: 'work', title: '全級會議' })
    const personal = event({ account_key: 'personal', title: '全級會議（補）' })
    expect(filterClones([work, personal])).toEqual([work, personal])
  })

  it('trim 後相同先算同標題（普通 .trim()）', () => {
    const work = event({ account_key: 'work', title: '  全級會議  ' })
    const personal = event({
      account_key: 'personal',
      title: '全級會議',
      start_time: work.start_time,
    })
    expect(filterClones([work, personal])).toEqual([work])
  })

  it('personal 無 work 對應 → 保留', () => {
    const personal = event({ account_key: 'personal', title: '睇醫生' })
    expect(filterClones([personal])).toEqual([personal])
  })

  it('多個 work 同標題：任何一個 ≤5 分鐘都濾', () => {
    const workA = event({ account_key: 'work', title: '會議', start_time: '2026-11-27T01:00:00.000Z' })
    const workB = event({ account_key: 'work', title: '會議', start_time: '2026-11-27T05:00:00.000Z' })
    const personal = event({
      account_key: 'personal',
      title: '會議',
      start_time: '2026-11-27T05:03:00.000Z',
    })
    expect(filterClones([workA, workB, personal])).toEqual([workA, workB])
  })

  it('已取消嘅 work 事件唔會壓住 personal 副本（NIT3）；cancelled 行本身照留（groupEvents 先過濾）', () => {
    const work = event({
      account_key: 'work',
      title: '全級會議',
      cancelled_at: '2026-11-27T00:30:00.000Z',
    })
    const personal = event({
      account_key: 'personal',
      title: '全級會議',
      start_time: work.start_time, // 與（已取消）work 同一分鐘——若無 NIT3 修正會被當 clone 濾走
    })
    expect(filterClones([work, personal])).toEqual([work, personal])
  })
})

describe('groupEvents', () => {
  it('空輸入回空結構（R3-2：結構存在，render 照出標題＋「無事件」）', () => {
    expect(groupEvents([], NOW)).toEqual({ today: [], tomorrow: [], upcoming: [] })
  })

  it('後日（今日+2）事件入 Upcoming 並有逐日小標題（R1-8）', () => {
    const ev = event({
      relevance: 'linked',
      start_time: '2026-11-29T01:00:00.000Z', // HK 11-29 09:00
      end_time: '2026-11-29T02:00:00.000Z',
    })
    const groups = groupEvents([ev], NOW)
    expect(groups.today).toEqual([])
    expect(groups.tomorrow).toEqual([])
    expect(groups.upcoming).toHaveLength(1)
    expect(groups.upcoming[0].dateStr).toBe('2026-11-29')
    expect(groups.upcoming[0].label).toBe('29/11（日）')
    expect(groups.upcoming[0].events).toEqual([ev])
  })

  it('Upcoming 只收 relevance=linked；context 唔收', () => {
    const linked = event({
      relevance: 'linked',
      start_time: '2026-11-29T01:00:00.000Z',
      end_time: '2026-11-29T02:00:00.000Z',
    })
    const context = event({
      relevance: 'context',
      start_time: '2026-11-29T03:00:00.000Z',
      end_time: '2026-11-29T04:00:00.000Z',
    })
    const groups = groupEvents([linked, context], NOW)
    expect(groups.upcoming[0].events).toEqual([linked])
  })

  it('全部 context 時 upcoming 為空陣列，今日聽日照常顯示', () => {
    const today = event({ start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T02:00:00.000Z' })
    const future = event({
      relevance: 'context',
      start_time: '2026-11-29T01:00:00.000Z',
      end_time: '2026-11-29T02:00:00.000Z',
    })
    const groups = groupEvents([today, future], NOW)
    expect(groups.today).toEqual([today])
    expect(groups.upcoming).toEqual([])
  })

  it('今日／聽日唔過濾 relevance（noise 都顯示）', () => {
    const noise = event({
      relevance: 'noise',
      start_time: '2026-11-27T01:00:00.000Z',
      end_time: '2026-11-27T02:00:00.000Z',
    })
    expect(groupEvents([noise], NOW).today).toEqual([noise])
  })

  it('day6（第 6 日）23:59 入 Upcoming；day7 00:00（= +7 日）唔喺任何組', () => {
    const day6 = event({
      relevance: 'linked',
      start_time: '2026-12-03T15:00:00.000Z', // HK 12-03 23:00
      end_time: '2026-12-03T15:59:00.000Z', // HK 12-03 23:59
    })
    const day7 = event({
      id: 'day7',
      relevance: 'linked',
      start_time: '2026-12-03T16:00:00.000Z', // HK 12-04 00:00 = S7（唔 < S7）
      end_time: '2026-12-03T17:00:00.000Z',
    })
    const groups = groupEvents([day6, day7], NOW)
    expect(groups.upcoming.map((d) => d.dateStr)).toEqual(['2026-12-03'])
    expect(groups.upcoming[0].label).toBe('03/12（四）')
    expect(groups.upcoming[0].events).toEqual([day6])
    expect(groups.today).toEqual([])
    expect(groups.tomorrow).toEqual([])
  })

  it('跨日（疊今日+聽日）只歸今日（首個重疊日）', () => {
    const ev = event({
      start_time: '2026-11-27T12:00:00.000Z', // HK 11-27 20:00
      end_time: '2026-11-27T18:00:00.000Z', // HK 11-28 02:00
    })
    const groups = groupEvents([ev], NOW)
    expect(groups.today).toEqual([ev])
    expect(groups.tomorrow).toEqual([])
  })

  it('跨日 11/26 14:00 – 11/27 12:00：11/27 10:00 入今日＋進行中；15:00 仍在今日但變灰', () => {
    const ev = event({
      start_time: '2026-11-26T06:00:00.000Z', // HK 11-26 14:00
      end_time: '2026-11-27T04:00:00.000Z', // HK 11-27 12:00
    })
    const now10 = Date.UTC(2026, 10, 27, 2, 0, 0) // HK 10:00
    const now15 = Date.UTC(2026, 10, 27, 7, 0, 0) // HK 15:00
    expect(groupEvents([ev], now10).today).toEqual([ev])
    expect(groupEvents([ev], now15).today).toEqual([ev])
    expect(eventState(ev, now10)).toEqual({ past: false, ongoing: true, allDay: false })
    expect(eventState(ev, now15)).toEqual({ past: true, ongoing: false, allDay: false })
  })

  it('cancelled_at 非 NULL 一律唔分組', () => {
    const cancelled = event({ cancelled_at: '2026-11-27T01:00:00.000Z' })
    const normal = event({ start_time: '2026-11-27T06:00:00.000Z', end_time: '2026-11-27T07:00:00.000Z' })
    const groups = groupEvents([cancelled, normal], NOW)
    expect(groups.today).toEqual([normal])
  })

  it('完全過去（end ≤ 今日00:00）同窗口外未來事件唔會出現', () => {
    const past = event({
      start_time: '2026-11-26T02:00:00.000Z', // HK 11-26 10:00
      end_time: '2026-11-26T03:00:00.000Z', // end < S0
    })
    const future = event({
      relevance: 'linked',
      start_time: '2026-12-03T16:00:00.000Z', // = S7
      end_time: '2026-12-03T17:00:00.000Z',
    })
    expect(groupEvents([past, future], NOW)).toEqual({ today: [], tomorrow: [], upcoming: [] })
  })

  it('sortWithinDay：全日最前，其後 start_time 升序', () => {
    const allday = event({
      is_all_day: true,
      start_time: '2026-11-26T16:00:00.000Z', // HK 00:00
      end_time: '2026-11-27T15:59:59.000Z',
    })
    const at9 = event({ start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T02:00:00.000Z' }) // HK 09:00
    const at8 = event({ start_time: '2026-11-27T00:00:00.000Z', end_time: '2026-11-27T01:00:00.000Z' }) // HK 08:00
    expect(sortWithinDay([at9, allday, at8])).toEqual([allday, at8, at9])
  })

  it('sortWithinDay：同 start 比 end；同 end 比標題（ASCII，免 collation 差異）', () => {
    const a = event({ title: 'meeting-b', start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T02:00:00.000Z' })
    const b = event({ title: 'meeting-a', start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T02:00:00.000Z' })
    const short = event({ title: 'meeting-a', start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T01:30:00.000Z' })
    expect(sortWithinDay([a, b, short])).toEqual([short, b, a])
  })

  it('groupEvents 內各組都經 sortWithinDay（全日排該日最前）', () => {
    const allday = event({
      is_all_day: true,
      start_time: '2026-11-26T16:00:00.000Z',
      end_time: '2026-11-27T15:59:59.000Z',
    })
    const at9 = event({ start_time: '2026-11-27T01:00:00.000Z', end_time: '2026-11-27T02:00:00.000Z' })
    const groups = groupEvents([at9, allday], NOW)
    expect(groups.today).toEqual([allday, at9])
  })
})

describe('eventState', () => {
  it('同日進行中（09:00–17:00 @ 10:00）唔標進行中、唔變灰（Conflicts #2）', () => {
    const ev = event({
      start_time: '2026-11-27T01:00:00.000Z', // HK 09:00
      end_time: '2026-11-27T09:00:00.000Z', // HK 17:00
    })
    const now10 = Date.UTC(2026, 10, 27, 2, 0, 0)
    expect(eventState(ev, now10)).toEqual({ past: false, ongoing: false, allDay: false })
  })

  it('同日已過（09:00 @ 14:30）變灰', () => {
    const ev = event({
      start_time: '2026-11-27T01:00:00.000Z', // HK 09:00
      end_time: '2026-11-27T02:00:00.000Z', // HK 10:00
    })
    const now1430 = Date.UTC(2026, 10, 27, 6, 30, 0)
    expect(eventState(ev, now1430).past).toBe(true)
  })

  it('allDay 透傳 is_all_day', () => {
    const allday = event({ is_all_day: true })
    expect(eventState(allday, NOW).allDay).toBe(true)
    expect(eventState(event(), NOW).allDay).toBe(false)
  })
})

describe('窗口↔分組性質測試（杜絕「查到但唔顯示」）', () => {
  /**
   * 對窗口前後 ±48h 至 +192h 逐小時生成 1 小時長合成事件，先以與查詢完全
   * 同一嘅條件（end > S0 ∧ start < S7）模擬 fetch，再 assert：
   * 1. 每個 fetched 事件都落某一組（唔會「查到但唔顯示」）
   * 2. 冇任何事件重複出現喺多過一組
   * 3. 窗口邊界（end = S0、start = S7）嚴格排除
   * 合成事件全部 relevance='linked'（relevance 過濾另行測試）。
   */
  it('窗口內每小時事件都恰好落一組，邊界嚴格排除', () => {
    const all: EventRow[] = []
    for (let h = -48; h <= 191; h++) {
      const start = S0 + h * HOUR
      all.push(
        event({
          id: `h${h}`,
          relevance: 'linked',
          start_time: new Date(start).toISOString(),
          end_time: new Date(start + HOUR).toISOString(),
        }),
      )
    }
    // 模擬 api 查詢條件：gt(end_time, startIso) ∧ lt(start_time, endIso)
    const fetched = all.filter(
      (e) => Date.parse(e.end_time) > S0 && Date.parse(e.start_time) < S7,
    )
    // 邊界：h=-1（end = S0）同 h=168（start = S7）被嚴格條件排除
    expect(fetched).toHaveLength(168) // h = 0..167
    expect(fetched.some((e) => e.id === 'h-1')).toBe(false)
    expect(fetched.some((e) => e.id === 'h168')).toBe(false)

    const groups = groupEvents(fetched, NOW)
    const groupedIds = [
      ...groups.today,
      ...groups.tomorrow,
      ...groups.upcoming.flatMap((d) => d.events),
    ].map((e) => e.id)
    expect(groupedIds).toHaveLength(fetched.length) // 冇重複、冇遺漏
    expect([...groupedIds].sort()).toEqual(fetched.map((e) => e.id).sort())

    // 逐日分佈：今日/聽日各 24，Upcoming 第 2–6 日各 24
    expect(groups.today).toHaveLength(24)
    expect(groups.tomorrow).toHaveLength(24)
    expect(groups.upcoming.map((d) => d.dateStr)).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
    ])
    expect(groups.upcoming.map((d) => d.label)).toEqual([
      '29/11（日）',
      '30/11（一）',
      '01/12（二）',
      '02/12（三）',
      '03/12（四）',
    ])
    for (const day of groups.upcoming) {
      expect(day.events).toHaveLength(24)
    }
  })
})
