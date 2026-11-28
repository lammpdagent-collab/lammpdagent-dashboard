import { describe, expect, it } from 'vitest'

import { classifyRelevance, RELEVANCE_KEYWORDS } from '../briefing/relevance.ts'
import {
  CliArgsError,
  computeSync,
  dedupeEvents,
  fetchAll,
  fetchEvents,
  fetchTasks,
  groupTasks,
  hktAfternoonWindow,
  hktDateStr,
  hktDayWindow,
  hktNowParts,
  hktQueryWindow,
  hktUpcomingWindows,
  parseArgs,
  parseDotEnv,
  resolveEnv,
  runCli,
  type CycleRow,
  type Deps,
  type EventRow,
  type MetaRow,
  type TaskRow,
} from '../briefing/fetch.ts'

// ---------------------------------------------------------------------------
// 測試基準：NOW = HKT 2026-11-27（星期五）12:00 正午。
// - tomorrow 00:00 HKT = 2026-11-27T16:00:00.000Z
// - context 上限（+3日）= 2026-11-29T16:00:00.000Z
// - linked 上限（+8日）= 2026-12-04T16:00:00.000Z
// - morning DB 窗 = [2026-11-26T16:00Z, 2026-12-03T16:00Z)
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-27T04:00:00.000Z')

function ev(p: Partial<EventRow> & Pick<EventRow, 'id' | 'title' | 'start_time'>): EventRow {
  return {
    end_time: '2026-12-31T00:00:00.000Z',
    is_all_day: false,
    account_key: 'personal',
    source_calendar: 'personal',
    ...p,
  }
}

function task(p: Partial<TaskRow> & Pick<TaskRow, 'id' | 'title'>): TaskRow {
  return {
    priority: 'medium',
    category: 'general',
    due_date: null,
    pinned: false,
    created_at: '2026-11-01T00:00:00.000Z',
    ...p,
  }
}

function meta(key: string, status: string, hoursAgo: number, message: string | null = null): MetaRow {
  return {
    key,
    status,
    message,
    last_run_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  }
}

const PERSONAL_KEY = 'calendar_sync:personal'
const WORK_KEY = 'calendar_sync:work'

/**
 * 假 deps：queryEvents 照真 query chain 嘅過濾行為——
 * [lower, upper)（lower = allDayFromIso ?? fromIso），afternoon（allDayFromIso 有值）時
 * 全日事件改受 all-day 下界限制、唔受 13:00 限制；其他原樣回傳。
 * 頂層可以直接覆寫任一 dep（M4 錯誤測試用）。
 */
function makeDeps(
  o: {
    now?: Date
    events?: EventRow[]
    tasks?: TaskRow[]
    meta?: MetaRow[]
    cycle?: CycleRow[]
  } & Partial<Omit<Deps, 'now'>> = {},
): Deps {
  const now = o.now ?? NOW
  const base: Deps = {
    now: () => now,
    queryEvents: async (fromIso, toIso, allDayFromIso) => {
      const lowerMs = Date.parse(allDayFromIso ?? fromIso)
      const upperMs = Date.parse(toIso)
      const fromMs = Date.parse(fromIso)
      return (o.events ?? []).filter((row) => {
        const start = Date.parse(row.start_time)
        if (start < lowerMs || start >= upperMs) return false
        // afternoon（allDayFromIso 有值）：全日事件唔受 13:00 下界限制
        return allDayFromIso != null && row.is_all_day ? true : start >= fromMs
      })
    },
    queryTasks: async () => o.tasks ?? [],
    queryCycleDays: async (dates) => (o.cycle ?? []).filter((row) => dates.includes(row.date)),
    querySystemMeta: async (keys) => (o.meta ?? []).filter((row) => keys.includes(row.key)),
  }
  return {
    now: base.now,
    queryEvents: o.queryEvents ?? base.queryEvents,
    queryTasks: o.queryTasks ?? base.queryTasks,
    queryCycleDays: o.queryCycleDays ?? base.queryCycleDays,
    querySystemMeta: o.querySystemMeta ?? base.querySystemMeta,
  }
}

async function runMorning(o?: Parameters<typeof makeDeps>[0]) {
  const result = await runCli(['--mode', 'morning'], makeDeps(o))
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 相關性（R1–R6）
// ---------------------------------------------------------------------------

describe('相關性（R1–R6）', () => {
  it('R1: Day A / DayＡ / Day  B / DayC → noise', () => {
    expect(classifyRelevance('Day A 校曆循環日', null)).toBe('noise')
    expect(classifyRelevance('DayＡ校曆循環日', null)).toBe('noise')
    expect(classifyRelevance('Day  B 校曆循環日', null)).toBe('noise')
    expect(classifyRelevance('DayC 校曆循環日', null)).toBe('noise')
  })

  it('R2: 討論 Day A 安排 → 唔係 noise（Day 前綴規則係錨定開頭）', () => {
    expect(classifyRelevance('討論 Day A 安排', null)).not.toBe('noise')
  })

  it.each(RELEVANCE_KEYWORDS)('R3: keyword「%s」→ linked', (keyword) => {
    expect(classifyRelevance(`測試主題：${keyword}研討`, null)).toBe('linked')
  })

  it('R4: dickson / psmcd 細楷 → linked（大小寫不敏感）', () => {
    expect(classifyRelevance('dickson 會議', null)).toBe('linked')
    expect(classifyRelevance('psmcd 週會', null)).toBe('linked')
  })

  it('R5: 無命中 → context；sourceCalendar null vs 有值 一樣', () => {
    expect(classifyRelevance('普通部門會議', null)).toBe('context')
    expect(classifyRelevance('普通部門會議', 'personal')).toBe('context')
    expect(classifyRelevance('普通部門會議', 'work')).toBe('context')
  })

  it('R6: Day A 民安左右 → noise（Day 規則優先過 keyword）', () => {
    expect(classifyRelevance('Day A 民安左右', null)).toBe('noise')
  })

  it('N5: 前置空白嘅 Day 標題 → noise（分類前先 trim）', () => {
    expect(classifyRelevance(' Day A 循環日', null)).toBe('noise')
  })
})

// ---------------------------------------------------------------------------
// 時間窗（W1–W5）
// ---------------------------------------------------------------------------

describe('時間窗（W1–W5）', () => {
  it('W1: 今日窗 [00:00 HKT, +1日)', () => {
    expect(hktDayWindow('2026-11-28')).toEqual([
      '2026-11-27T16:00:00.000Z',
      '2026-11-28T16:00:00.000Z',
    ])
  })

  it('W2: afternoon 窗 [13:00 HKT, 明日 00:00 HKT)', () => {
    expect(hktAfternoonWindow('2026-11-28')).toEqual([
      '2026-11-28T05:00:00.000Z',
      '2026-11-28T16:00:00.000Z',
    ])
  })

  it('W3: upcoming 窗 linked [+1日,+8日) / context [+1日,+3日)', () => {
    const windows = hktUpcomingWindows('2026-11-28')
    expect(windows.linked).toEqual(['2026-11-28T16:00:00.000Z', '2026-12-05T16:00:00.000Z'])
    expect(windows.context).toEqual(['2026-11-28T16:00:00.000Z', '2026-11-30T16:00:00.000Z'])
  })

  it('W4: query 窗 [from 00:00 HKT, to+1日 00:00 HKT)', () => {
    expect(hktQueryWindow('2026-12-01', '2026-12-31')).toEqual([
      '2026-11-30T16:00:00.000Z',
      '2026-12-31T16:00:00.000Z',
    ])
  })

  it('W5: HKT 換日 16:00Z 邊界', () => {
    expect(hktNowParts(new Date('2026-11-27T16:30:00.000Z'))).toEqual({
      generated_at: '2026-11-28T00:30:00+08:00',
      date: '2026-11-28',
      weekday: '星期六',
    })
    expect(hktDateStr(new Date('2026-11-27T15:59:59.000Z'))).toBe('2026-11-27')
  })
})

// ---------------------------------------------------------------------------
// parseArgs / parseDotEnv（P1–P4）
// ---------------------------------------------------------------------------

describe('parseArgs（P1–P3）', () => {
  it('P1: 三 mode 正常 + --mode=X 寫法', () => {
    expect(parseArgs(['--mode', 'morning'])).toEqual({ mode: 'morning' })
    expect(parseArgs(['--mode', 'afternoon'])).toEqual({ mode: 'afternoon' })
    expect(parseArgs(['--mode', 'query', '--from', '2026-12-01', '--to', '2026-12-31'])).toEqual({
      mode: 'query',
      from: '2026-12-01',
      to: '2026-12-31',
    })
    expect(parseArgs(['--mode=query', '--from=2026-12-01', '--to=2026-12-31'])).toEqual({
      mode: 'query',
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })

  it('P2: query 缺 from/to / 格式錯 / from>to / >366 日 → throw', () => {
    expect(() => parseArgs(['--mode', 'query'])).toThrow(CliArgsError)
    expect(() => parseArgs(['--mode', 'query', '--from', '2026-12-01'])).toThrow(CliArgsError)
    expect(() => parseArgs(['--mode', 'query', '--from', '2026-1-1', '--to', '2026-12-31'])).toThrow(
      /YYYY-MM-DD/,
    )
    expect(() => parseArgs(['--mode', 'query', '--from', '2026-12-02', '--to', '2026-12-01'])).toThrow(
      /晚過/,
    )
    expect(() => parseArgs(['--mode', 'query', '--from', '2026-01-01', '--to', '2027-01-03'])).toThrow(
      /超過上限/,
    )
    // 剛好 366 日：唔 throw
    expect(parseArgs(['--mode', 'query', '--from', '2026-01-01', '--to', '2027-01-02'])).toEqual({
      mode: 'query',
      from: '2026-01-01',
      to: '2027-01-02',
    })
  })

  it('P3: morning / afternoon 帶 --from 或 --to → throw', () => {
    expect(() => parseArgs(['--mode', 'morning', '--from', '2026-11-27'])).toThrow(/只適用於 query/)
    expect(() => parseArgs(['--mode', 'afternoon', '--to', '2026-11-27'])).toThrow(/只適用於 query/)
  })
})

describe('parseDotEnv（P4）', () => {
  it('P4: CRLF / BOM / 註釋 / 空行 / 值含 = / 成對引號', () => {
    expect(parseDotEnv('A=B\r\nC=D\n')).toEqual({ A: 'B', C: 'D' })
    expect(parseDotEnv('﻿A=B')).toEqual({ A: 'B' })
    expect(parseDotEnv('#註釋\n\nA=B\n   \n#另一行\nC=D\n')).toEqual({ A: 'B', C: 'D' })
    expect(parseDotEnv('URL=https://x?a=1&b=2')).toEqual({ URL: 'https://x?a=1&b=2' })
    expect(parseDotEnv('A="x y"\nB=\'z\'\nC=D')).toEqual({ A: 'x y', B: 'z', C: 'D' })
    // 註釋符號喺值入面唔算註釋
    expect(parseDotEnv('K=#notcomment')).toEqual({ K: '#notcomment' })
  })

  it('P4b: inline 註釋 / export 前綴 / 引號後註釋（r4 m5）', () => {
    // ① 未加引號：第一個 ` #` 之後係註釋；冇空格嘅 # 照算值
    expect(parseDotEnv('A=B # c\nC=D#keep')).toEqual({ A: 'B', C: 'D#keep' })
    // ② export 前綴（多個空格都得）
    expect(parseDotEnv('export K=v\nexport  W=x y # z')).toEqual({ K: 'v', W: 'x y' })
    // ③ 引號後註釋：先剝引號，後面忽略；引號內嘅 # 唔算註釋
    expect(parseDotEnv('A="x" # c\nB=\'y # z\'')).toEqual({ A: 'x', B: 'y # z' })
  })
})

// ---------------------------------------------------------------------------
// 同步新鮮度（S1–S5）
// ---------------------------------------------------------------------------

describe('computeSync（S1–S5）', () => {
  it('S1: 兩行 ok 且 <26h → { stale:false, reason:null }', () => {
    const status = computeSync([meta(PERSONAL_KEY, 'ok', 2), meta(WORK_KEY, 'ok', 3)], NOW)
    expect(status.stale).toBe(false)
    expect(status.reason).toBeNull()
  })

  it('S2: 26h+ε → stale；剛好 26h → fresh', () => {
    expect(
      computeSync([meta(PERSONAL_KEY, 'ok', 26.01), meta(WORK_KEY, 'ok', 2)], NOW).stale,
    ).toBe(true)
    const fresh = computeSync([meta(PERSONAL_KEY, 'ok', 26), meta(WORK_KEY, 'ok', 2)], NOW)
    expect(fresh.stale).toBe(false)
    expect(fresh.reason).toBeNull()
  })

  it('S3: 一行 error → stale，reason 含 message', () => {
    const status = computeSync(
      [meta(PERSONAL_KEY, 'error', 1, 'token 過期'), meta(WORK_KEY, 'ok', 2)],
      NOW,
    )
    expect(status.stale).toBe(true)
    expect(status.reason).toContain('token 過期')
  })

  it('S4: 零行 → { stale:true, reason:"從未同步" }', () => {
    expect(computeSync([], NOW)).toEqual({ stale: true, reason: '從未同步', sources: [] })
  })

  it('S5: 缺單邊 → stale，講明邊個缺', () => {
    const status = computeSync([meta(PERSONAL_KEY, 'ok', 2)], NOW)
    expect(status.stale).toBe(true)
    expect(status.reason).toContain(WORK_KEY)
  })

  it('S6: last_run_at 非法格式 → stale（r4 m7：NaN 唔可以判 fresh）', () => {
    const status = computeSync(
      [
        { key: PERSONAL_KEY, status: 'ok', last_run_at: 'garbage', message: null },
        meta(WORK_KEY, 'ok', 2),
      ],
      NOW,
    )
    expect(status.stale).toBe(true)
    expect(status.reason).toContain(PERSONAL_KEY)
    expect(status.reason).toContain('last_run_at 格式無效')
  })

  it('S7: sync.sources 逐 key 輸出 DB 原值；缺行嘅 key 唔出現（r4 m2）', () => {
    const lastRun = new Date(NOW.getTime() - 2 * 3_600_000).toISOString()
    const status = computeSync([meta(PERSONAL_KEY, 'ok', 2)], NOW)
    expect(status.sources).toEqual([{ key: PERSONAL_KEY, last_run_at: lastRun, status: 'ok' }])
  })
})

// ---------------------------------------------------------------------------
// briefing payload（B1–B7）
// ---------------------------------------------------------------------------

describe('briefing payload（B1–B7）', () => {
  it('B1: 跨午夜（HKT 00:05）入 today；午夜前 10 分鐘唔入', async () => {
    const payload = await runMorning({
      events: [
        ev({ id: 'e-mid', title: '跨午夜晨會', start_time: '2026-11-26T16:05:00.000Z' }),
        ev({ id: 'e-pre', title: '昨日深夜', start_time: '2026-11-26T15:50:00.000Z' }),
      ],
    })
    const today = payload.today as { id: string }[]
    expect(today.map((row) => row.id)).toEqual(['e-mid'])
  })

  it('B2: all-day 排前', async () => {
    const payload = await runMorning({
      events: [
        ev({ id: 'e-timed', title: '朝早例會', start_time: '2026-11-27T01:00:00.000Z' }),
        ev({
          id: 'e-allday',
          title: '全日校曆活動',
          start_time: '2026-11-26T16:00:00.000Z',
          is_all_day: true,
        }),
      ],
    })
    const today = payload.today as { id: string; is_all_day: boolean }[]
    expect(today.map((row) => row.id)).toEqual(['e-allday', 'e-timed'])
    expect(today[0].is_all_day).toBe(true)
  })

  it('B3: 空輸入 → today / upcoming 係 [] 唔係 null', async () => {
    const payload = await runMorning({})
    // toEqual([]) 已隱含「係 array 且唔係 null」，Array.isArray 冇再加值
    expect(payload.today).toEqual([])
    expect(payload.upcoming).toEqual([])
  })

  it('B4: linked 5日後入 upcoming；context 5日後唔入；context 2日內入；Day A 明日（窗內）唔入', async () => {
    const payload = await runMorning({
      events: [
        // linked：HKT 12-02 09:00（5 日後），linked 窗 [+1日, +8日) 內
        ev({ id: 'l-5d', title: 'Dickson巡堂', start_time: '2026-12-02T01:00:00.000Z' }),
        // context：HKT 12-02 15:00（5 日後），超過 context 窗 +3日 → 唔入
        ev({ id: 'c-5d', title: '部門會議', start_time: '2026-12-02T07:00:00.000Z' }),
        // context：HKT 11-29 09:00（2 日後），context 窗內 → 入
        ev({ id: 'c-2d', title: '小組會議', start_time: '2026-11-29T01:00:00.000Z' }),
        // noise：Day A HKT 明日 09:00（context 窗內）→ 時間窗本身入選，
        // 唔入 upcoming 只可以係因為 Day 標題分類（防假陽性，r4 M3）
        ev({ id: 'n-1d', title: 'Day A 週會', start_time: '2026-11-28T01:00:00.000Z' }),
        // negative control：同一時間、非 Day 標題 → context，要入 upcoming
        ev({ id: 'ctrl-1d', title: '部門會議', start_time: '2026-11-28T01:00:00.000Z' }),
      ],
    })
    const upcoming = payload.upcoming as { id: string; title: string }[]
    expect(upcoming.map((row) => row.id)).toEqual(['ctrl-1d', 'c-2d', 'l-5d'])
    // r4 M3 明確斷言：'Day A 週會' 唔在 upcoming、'部門會議' 在 upcoming
    expect(upcoming.map((row) => row.title)).not.toContain('Day A 週會')
    expect(upcoming.map((row) => row.title)).toContain('部門會議')
  })

  it('B5: afternoon 09:00 唔入 / 15:00 入 / upcoming === []', async () => {
    const result = await runCli(
      ['--mode', 'afternoon'],
      makeDeps({
        now: new Date('2026-11-27T08:00:00.000Z'), // HKT 16:00
        events: [
          ev({ id: 'a-0900', title: '上午會議', start_time: '2026-11-27T01:00:00.000Z' }),
          ev({ id: 'a-1200', title: '中午會議', start_time: '2026-11-27T04:00:00.000Z' }),
          ev({ id: 'a-1500', title: '下午會議', start_time: '2026-11-27T07:00:00.000Z' }),
        ],
      }),
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { today: { id: string }[]; upcoming: unknown[] }
    expect(payload.today.map((row) => row.id)).toEqual(['a-1500'])
    expect(payload.upcoming).toEqual([])
  })

  it('B8: afternoon 全日事件（今日 00:00 HKT）入 today；尋日／聽日全日事件唔入（r4 M2）', async () => {
    const result = await runCli(
      ['--mode', 'afternoon'],
      makeDeps({
        now: new Date('2026-11-27T08:00:00.000Z'), // HKT 11-27 16:00
        events: [
          // 全日今日：HKT 11-27 00:00 —— spec「全日事件一定出現」
          ev({ id: 'a-holiday', title: '假期', start_time: '2026-11-26T16:00:00.000Z', is_all_day: true }),
          // 全日尋日：HKT 11-26 00:00 —— all-day 下界（今日 00:00）之外 → 唔入
          ev({ id: 'a-old', title: '尋日假期', start_time: '2026-11-25T16:00:00.000Z', is_all_day: true }),
          // 全日聽日：HKT 11-28 00:00 —— 上界（明日 00:00）之外 → 唔入
          ev({ id: 'a-tmr', title: '聽日假期', start_time: '2026-11-27T16:00:00.000Z', is_all_day: true }),
          // 15:00 非全日照入
          ev({ id: 'a-1500', title: '下午會議', start_time: '2026-11-27T07:00:00.000Z' }),
          // 09:00 非全日照唔入
          ev({ id: 'a-0900', title: '上午會議', start_time: '2026-11-27T01:00:00.000Z' }),
        ],
      }),
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { today: { id: string }[]; upcoming: unknown[] }
    expect(payload.today.map((row) => row.id)).toEqual(['a-holiday', 'a-1500'])
    expect(payload.upcoming).toEqual([])
  })

  it('B6: tasks 四級 / pinned 先 / due_date asc null 尾 / created_at tiebreak / overdue / 空表', () => {
    const groups = groupTasks(
      [
        task({ id: 't-low', title: 'low 任務', priority: 'low' }),
        task({
          id: 't-high-b',
          title: 'high due 昨天（遲建）',
          priority: 'high',
          due_date: '2026-11-26',
          created_at: '2026-11-02T00:00:00.000Z',
        }),
        task({
          id: 't-high-a',
          title: 'high due 昨天（早建）',
          priority: 'high',
          due_date: '2026-11-26',
          created_at: '2026-11-01T00:00:00.000Z',
        }),
        task({ id: 't-crit-pinned', title: 'critical pinned', priority: 'critical', pinned: true }),
        task({
          id: 't-crit-unpinned',
          title: 'critical 冇 pin 但 due 早啲',
          priority: 'critical',
          due_date: '2026-11-10',
        }),
        task({ id: 't-med-today', title: 'medium due 今日', priority: 'medium', due_date: '2026-11-27' }),
        task({ id: 't-med-null', title: 'medium 冇 due', priority: 'medium' }),
        task({ id: 't-med-early', title: 'medium due 早啲', priority: 'medium', due_date: '2026-11-20' }),
      ],
      '2026-11-27',
    )
    expect(groups.critical.map((row) => row.id)).toEqual(['t-crit-pinned', 't-crit-unpinned'])
    expect(groups.high.map((row) => row.id)).toEqual(['t-high-a', 't-high-b'])
    expect(groups.medium.map((row) => row.id)).toEqual(['t-med-early', 't-med-today', 't-med-null'])
    expect(groups.low.map((row) => row.id)).toEqual(['t-low'])
    // overdue：昨日 true、今日 false、null false
    expect(groups.high.map((row) => row.overdue)).toEqual([true, true])
    expect(groups.medium.find((row) => row.id === 't-med-today')?.overdue).toBe(false)
    expect(groups.medium.find((row) => row.id === 't-med-null')?.overdue).toBe(false)

    const empty = groupTasks([], '2026-11-27')
    expect(empty).toEqual({ critical: [], high: [], medium: [], low: [] })
  })

  it('B7: briefing key set 恰好齊；event / task 欄位齊', async () => {
    const payload = await runMorning({
      events: [ev({ id: 'e1', title: 'Dickson例會', start_time: '2026-11-27T01:00:00.000Z' })],
      tasks: [task({ id: 'T1', title: '備課', priority: 'high' })],
      meta: [meta(PERSONAL_KEY, 'ok', 2), meta(WORK_KEY, 'ok', 3)],
      cycle: [{ date: '2026-11-27', day_label: 'A' }, { date: '2026-11-28', day_label: 'B' }],
    })
    expect(Object.keys(payload).sort()).toEqual([
      'cycle',
      'date',
      'generated_at',
      'sync',
      'tasks',
      'today',
      'upcoming',
      'weekday',
    ])
    expect(payload.cycle).toEqual({ today: 'A', tomorrow: 'B' })
    // r4 m2：sync 有 sources，逐項 { key, last_run_at, status }
    const sync = payload.sync as {
      stale: unknown
      reason: unknown
      sources: Record<string, unknown>[]
    }
    expect(Object.keys(sync).sort()).toEqual(['reason', 'sources', 'stale'])
    expect(sync.sources).toHaveLength(2)
    expect(sync.sources.map((source) => source.key)).toEqual([PERSONAL_KEY, WORK_KEY])
    for (const source of sync.sources) {
      expect(Object.keys(source).sort()).toEqual(['key', 'last_run_at', 'status'])
    }
    const eventOut = (payload.today as Record<string, unknown>[])[0]
    expect(Object.keys(eventOut).sort()).toEqual([
      'account_key',
      'end_time',
      'id',
      'is_all_day',
      'relevance',
      'source_calendar',
      'start_time',
      'title',
    ])
    const taskOut = (payload.tasks as Record<string, Record<string, unknown>[]>).high[0]
    expect(Object.keys(taskOut).sort()).toEqual([
      'category',
      'due_date',
      'id',
      'overdue',
      'pinned',
      'priority',
      'title',
    ])
  })
})

// ---------------------------------------------------------------------------
// query payload（Q1–Q6）
// ---------------------------------------------------------------------------

describe('query payload（Q1–Q6）', () => {
  it('Q1: events 按 [from 00:00 HKT, to+1日 00:00 HKT) 切', async () => {
    const result = await runCli(
      ['--mode', 'query', '--from', '2026-11-27', '--to', '2026-12-01'],
      makeDeps({
        events: [
          // from 日 00:00 HKT（含）
          ev({ id: 'q-start', title: '範圍開頭', start_time: '2026-11-26T16:00:00.000Z' }),
          // to 尾日 23:59 HKT（含）
          ev({ id: 'q-end', title: '範圍尾日', start_time: '2026-12-01T15:59:00.000Z' }),
          // to+1 日 00:00 HKT（唔含）
          ev({ id: 'q-after', title: '範圍後一日', start_time: '2026-12-02T16:00:00.000Z' }),
          // 範圍前
          ev({ id: 'q-before', title: '範圍前', start_time: '2026-11-25T00:00:00.000Z' }),
        ],
      }),
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { events: { id: string }[] }
    expect(payload.events.map((row) => row.id)).toEqual(['q-start', 'q-end'])
  })

  it('Q2: due_date 遠過 range 嘅 task 仍出現（queryTasks 唔按窗切）', async () => {
    const result = await runCli(
      ['--mode', 'query', '--from', '2026-12-01', '--to', '2026-12-31'],
      makeDeps({
        tasks: [task({ id: 't-far', title: '遠期任務', due_date: '2027-03-15' })],
      }),
    )
    const payload = JSON.parse(result.stdout) as { tasks: { id: string }[] }
    expect(payload.tasks.map((row) => row.id)).toEqual(['t-far'])
  })

  it('Q3: 空 range → events: []、tasks: []', async () => {
    const result = await runCli(
      ['--mode', 'query', '--from', '2026-12-01', '--to', '2026-12-31'],
      makeDeps({}),
    )
    const payload = JSON.parse(result.stdout) as { events: unknown[]; tasks: unknown[] }
    expect(payload.events).toEqual([])
    expect(payload.tasks).toEqual([])
  })

  it('Q4: query events 帶 relevance（含 noise）', async () => {
    const result = await runCli(
      ['--mode', 'query', '--from', '2026-12-01', '--to', '2026-12-31'],
      makeDeps({
        events: [
          ev({ id: 'q-noise', title: 'Day A 循環日', start_time: '2026-12-01T01:00:00.000Z' }),
          ev({ id: 'q-linked', title: 'Dickson會議', start_time: '2026-12-02T01:00:00.000Z' }),
          ev({ id: 'q-context', title: '普通會議', start_time: '2026-12-03T01:00:00.000Z' }),
        ],
      }),
    )
    const payload = JSON.parse(result.stdout) as { events: { id: string; relevance: string }[] }
    const byId = new Map(payload.events.map((row) => [row.id, row.relevance]))
    expect(byId.get('q-noise')).toBe('noise')
    expect(byId.get('q-linked')).toBe('linked')
    expect(byId.get('q-context')).toBe('context')
  })

  it('Q5: query key set 恰好 = generated_at / range / sync / events / tasks', async () => {
    const result = await runCli(
      ['--mode', 'query', '--from', '2026-12-01', '--to', '2026-12-31'],
      makeDeps({ meta: [meta(PERSONAL_KEY, 'ok', 2), meta(WORK_KEY, 'ok', 3)] }),
    )
    const payload = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['events', 'generated_at', 'range', 'sync', 'tasks'])
    expect(payload.range).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('Q6: fetchAll 分頁 —— 1570 → 2 頁；count 缺 → 短頁停；2000 → 2 頁停', async () => {
    // ① 1570 行 + count → 剛好 2 頁
    const calls1: Array<[number, number, boolean]> = []
    const rows1 = await fetchAll<number>(async (from, to, withCount) => {
      calls1.push([from, to, withCount])
      const all = Array.from({ length: 1570 }, (_, i) => i)
      return { rows: all.slice(from, to + 1), count: withCount ? 1570 : null }
    })
    expect(rows1).toHaveLength(1570)
    expect(calls1).toEqual([
      [0, 999, true],
      [1000, 1999, false],
    ])

    // ② count 攞唔到 → 短頁（570 行）即停
    const calls2: Array<[number, number, boolean]> = []
    const rows2 = await fetchAll<number>(async (from, to, withCount) => {
      calls2.push([from, to, withCount])
      const all = Array.from({ length: 1570 }, (_, i) => i)
      return { rows: all.slice(from, to + 1), count: null }
    })
    expect(rows2).toHaveLength(1570)
    expect(calls2).toEqual([
      [0, 999, true],
      [1000, 1999, false],
    ])

    // ③ 2000 行 + count → 2 頁停（唔會多走第三頁）
    const calls3: Array<[number, number, boolean]> = []
    const rows3 = await fetchAll<number>(async (from, to, withCount) => {
      calls3.push([from, to, withCount])
      const all = Array.from({ length: 2000 }, (_, i) => i)
      return { rows: all.slice(from, to + 1), count: withCount ? 2000 : null }
    })
    expect(rows3).toHaveLength(2000)
    expect(calls3).toEqual([
      [0, 999, true],
      [1000, 1999, false],
    ])
  })
})

// ---------------------------------------------------------------------------
// 去重（D1–D11）
// ---------------------------------------------------------------------------

describe('dedupeEvents（D1–D9）', () => {
  const START = '2026-12-01T01:00:00.000Z'

  it('D1: work + personal 同 title 同 start_time → 保留 work', () => {
    const out = dedupeEvents([
      ev({ id: 'p1', title: '賣旗日', start_time: START, account_key: 'personal' }),
      ev({ id: 'w1', title: '賣旗日', start_time: START, account_key: 'work' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('w1')
    expect(out[0].account_key).toBe('work')
  })

  it('D2: 只有 personal → 保留', () => {
    const out = dedupeEvents([ev({ id: 'p1', title: '賣旗日', start_time: START })])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p1')
  })

  it('D3: 賣書日兩個近似 title 同 start_time → 兩行都保留', () => {
    const out = dedupeEvents([
      ev({ id: 'a1', title: '賣書日（汪譚健雯莉）', start_time: START }),
      ev({ id: 'a2', title: '賣書日（汪譚健雯穎莉）', start_time: START }),
    ])
    expect(out.map((row) => row.id)).toEqual(['a1', 'a2'])
  })

  it('D4: 大小寫唔同 → 兩行保留', () => {
    const out = dedupeEvents([
      ev({ id: 'a1', title: 'Meeting', start_time: START }),
      ev({ id: 'a2', title: 'meeting', start_time: START }),
    ])
    expect(out).toHaveLength(2)
  })

  it('D5: 內部空白唔同（A B vs A  B）→ 兩行保留', () => {
    const out = dedupeEvents([
      ev({ id: 'a1', title: 'A B', start_time: START }),
      ev({ id: 'a2', title: 'A  B', start_time: START }),
    ])
    expect(out).toHaveLength(2)
  })

  it('D6: 前後空白（ A  vs A）→ 視為重複，保留 id 較細', () => {
    const out = dedupeEvents([
      ev({ id: 'b2', title: ' A ', start_time: START }),
      ev({ id: 'b1', title: 'A', start_time: START }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b1')
    expect(out[0].title).toBe('A')
  })

  it('D7: 同分鐘唔同秒（01:00:00 vs 01:00:30）→ 視為重複', () => {
    const out = dedupeEvents([
      ev({ id: 'a1', title: '例會', start_time: '2026-12-01T01:00:00.000Z' }),
      ev({ id: 'a2', title: '例會', start_time: '2026-12-01T01:00:30.000Z' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a1')
  })

  it('D8: 同 account 真重複 → 保留 id 字典序較細', () => {
    const out = dedupeEvents([
      ev({ id: 'b2', title: '例會', start_time: START }),
      ev({ id: 'b1', title: '例會', start_time: START }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b1')
  })

  it('D9: 去重後排序 all-day → start_time → id', () => {
    const out = dedupeEvents([
      ev({ id: 'z1', title: '晏晝會', start_time: '2026-11-28T02:00:00.000Z' }),
      ev({ id: 'a1', title: '全日活動', start_time: '2026-11-28T00:00:00.000Z', is_all_day: true }),
      ev({ id: 'm1', title: '晨會', start_time: '2026-11-28T01:00:00.000Z' }),
      // 跟 a1 撞 key：work 取代 personal → 換行成 a0
      ev({
        id: 'a0',
        title: '全日活動',
        start_time: '2026-11-28T00:00:00.000Z',
        is_all_day: true,
        account_key: 'work',
      }),
    ])
    expect(out.map((row) => row.id)).toEqual(['a0', 'm1', 'z1'])
  })

  it('D12: invalid start_time → throw，訊息帶 event id（r4 m3）', () => {
    expect(() =>
      dedupeEvents([ev({ id: 'bad-1', title: '壞日期', start_time: 'not-a-date' })]),
    ).toThrow(/invalid start_time for event bad-1/)
  })
})

describe('runCli 去重（D10–D11）', () => {
  it('D10: today 12 行（含 3 重複）→ 9', async () => {
    // 9 個 base：HKT 11-27 09:00–17:00（每小時一個），3 個重複（work 取代 ×1、同 account ×2）
    const times = Array.from({ length: 9 }, (_, n) =>
      new Date(Date.UTC(2026, 10, 26, 16) + (n + 1) * 3_600_000).toISOString(),
    )
    const events: EventRow[] = times.map((start, n) =>
      ev({ id: `e${String(n + 1).padStart(2, '0')}`, title: `會議 ${n + 1}`, start_time: start }),
    )
    events.push(
      ev({ id: 'e10', title: '會議 1', start_time: times[0], account_key: 'work' }),
      ev({ id: 'e11', title: '會議 2', start_time: times[1] }),
      ev({ id: 'e12', title: '會議 3', start_time: times[2] }),
    )
    const payload = await runMorning({ events })
    const today = payload.today as { id: string; title: string; start_time: string }[]
    expect(payload.upcoming).toEqual([])
    expect(today).toHaveLength(9)
    // 內容斷言：去重後冇 work/personal 重複對 —— (title.trim(), start_time 至分鐘) 冇撞
    const keys = new Set(today.map((row) => `${row.title.trim()}|${row.start_time.slice(0, 16)}`))
    expect(keys.size).toBe(today.length)
  })

  it('D11: upcoming 28 行（含 10 重複）→ 18', async () => {
    // 9 個 linked base：HKT 11-28 12:00 起每 12 小時一個（全部喺 linked [+1日,+8日) 內）
    const linked = Array.from({ length: 9 }, (_, i) =>
      ev({
        id: `L${String(i + 1).padStart(2, '0')}`,
        title: `Dickson巡堂 ${i + 1}`,
        start_time: new Date(Date.UTC(2026, 10, 27, 16) + (i + 1) * 43_200_000).toISOString(),
      }),
    )
    // 9 個 context base：全部喺 context [+1日,+3日) 內
    const contextTimes = [
      '2026-11-27T18:00:00.000Z',
      '2026-11-27T20:00:00.000Z',
      '2026-11-28T00:00:00.000Z',
      '2026-11-28T02:00:00.000Z',
      '2026-11-28T04:00:00.000Z',
      '2026-11-28T06:00:00.000Z',
      '2026-11-28T08:00:00.000Z',
      '2026-11-28T10:00:00.000Z',
      '2026-11-29T00:00:00.000Z',
    ]
    const context = contextTimes.map((start, i) =>
      ev({ id: `C${String(i + 1).padStart(2, '0')}`, title: `會議 ${i + 1}`, start_time: start }),
    )
    // 10 個重複：5 個 work 取代 linked、5 個同 account 保留 id 較細
    const duplicates: EventRow[] = [
      ...linked.slice(0, 5).map((row) =>
        ev({ ...row, id: `W${row.id.slice(1)}`, account_key: 'work' }),
      ),
      ...context.slice(0, 5).map((row) => ev({ ...row, id: `D${row.id.slice(1)}` })),
    ]
    const payload = await runMorning({ events: [...linked, ...context, ...duplicates] })
    const upcoming = payload.upcoming as { id: string }[]
    expect(upcoming).toHaveLength(18)
    // work 取代後 5 行 account 變 work、id 變 W01–W05
    const ids = new Set(upcoming.map((row) => row.id))
    expect(ids.has('W01')).toBe(true)
    expect(ids.has('L01')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// runCli 錯誤處理（M4）
// ---------------------------------------------------------------------------

describe('runCli 錯誤處理（M4）', () => {
  it('queryEvents throw → exit 1 + stdout 空 + stderr 含訊息', async () => {
    const deps = makeDeps({
      queryEvents: async () => {
        throw new Error('boom')
      },
    })
    const r = await runCli(['--mode', 'morning'], deps)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('boom')
  })

  it('部分查詢失敗 → 唔出半份 JSON', async () => {
    const deps = makeDeps({
      queryCycleDays: async () => {
        throw new Error('cycle fail')
      },
    })
    const r = await runCli(['--mode', 'morning'], deps)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
  })
})

// ---------------------------------------------------------------------------
// resolveEnv env fallback（m6）
// ---------------------------------------------------------------------------

describe('resolveEnv（m6）', () => {
  const fileEnv = {
    VITE_SUPABASE_URL: 'https://file.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'file-key',
  }

  it('process.env 空字串 → fallback 到 .env 值（|| 而非 ??）', () => {
    const r = resolveEnv(fileEnv, { VITE_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })
    expect(r.url).toBe('https://file.supabase.co')
    expect(r.key).toBe('file-key')
  })

  it('process.env 有值 → 優先過 .env', () => {
    const r = resolveEnv(fileEnv, {
      VITE_SUPABASE_URL: 'https://process.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'process-key',
    })
    expect(r.url).toBe('https://process.supabase.co')
    expect(r.key).toBe('process-key')
  })
})

// ---------------------------------------------------------------------------
// fetchEvents / fetchTasks query chain（M1 分頁 order、M2 afternoon all-day）
// ---------------------------------------------------------------------------

interface ChainCall {
  method: string
  args: unknown[]
}

/** 記錄每個 query builder 方法呼叫；await 時回傳 data/count（單頁，行數 ≤999）。 */
function chainClient(
  result: { data: unknown; error: unknown; count: number | null },
  calls: ChainCall[],
): Parameters<typeof fetchEvents>[0] {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'select', 'is', 'gte', 'lt', 'eq', 'or', 'order', 'range'] as const) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder as unknown as Parameters<typeof fetchEvents>[0]
}

describe('fetchEvents / fetchTasks query chain（M1/M2）', () => {
  const byMethod = (calls: ChainCall[], method: string) =>
    calls.filter((call) => call.method === method).map((call) => call.args)

  it('M1: fetchEvents 有 .order(start_time asc) + .order(id)；非 afternoon 冇 .or()', async () => {
    const calls: ChainCall[] = []
    const rows = [ev({ id: 'e1', title: 'x', start_time: '2026-11-27T01:00:00.000Z' })]
    await fetchEvents(
      chainClient({ data: rows, error: null, count: rows.length }, calls),
      '2026-11-26T16:00:00.000Z',
      '2026-12-03T16:00:00.000Z',
    )
    expect(byMethod(calls, 'order')).toEqual([
      ['start_time', { ascending: true }],
      ['id'],
    ])
    expect(byMethod(calls, 'or')).toEqual([])
    expect(byMethod(calls, 'gte')).toEqual([['start_time', '2026-11-26T16:00:00.000Z']])
  })

  it('M1: fetchTasks 有 .order(id)', async () => {
    const calls: ChainCall[] = []
    await fetchTasks(
      chainClient({ data: [task({ id: 'T1', title: 'x' })], error: null, count: 1 }, calls),
    )
    expect(byMethod(calls, 'order')).toEqual([['id']])
  })

  it('M2: afternoon → .is(cancelled_at null) + .gte(all-day 下界=今日00:00) + .or(13:00 | is_all_day) + .lt(明日00:00)', async () => {
    const calls: ChainCall[] = []
    await fetchEvents(
      chainClient({ data: [], error: null, count: 0 }, calls),
      '2026-11-27T05:00:00.000Z', // 今日 13:00 HKT
      '2026-11-27T16:00:00.000Z', // 明日 00:00 HKT
      '2026-11-26T16:00:00.000Z', // all-day 下界：今日 00:00 HKT
    )
    expect(byMethod(calls, 'gte')).toEqual([['start_time', '2026-11-26T16:00:00.000Z']])
    expect(byMethod(calls, 'or')).toEqual([
      ['start_time.gte.2026-11-27T05:00:00.000Z,is_all_day.eq.true'],
    ])
    expect(byMethod(calls, 'lt')).toEqual([['start_time', '2026-11-27T16:00:00.000Z']])
    // afternoon 加咗 .or(...) 之後，最需要釘住 cancelled_at IS NULL 冇被 or 繞過
    expect(byMethod(calls, 'is')).toEqual([['cancelled_at', null]])
  })
})
