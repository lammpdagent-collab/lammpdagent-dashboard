import { describe, expect, it } from 'vitest'
import {
  compareTasks,
  isVisibleTask,
  sortTasks,
  tagUsageCounts,
  toggleStatus,
} from '../src/lib/taskQuery'
import type { TaskRow } from '../src/lib/types'

// 基準：HK 2026-11-27（五）12:00
const NOW = Date.UTC(2026, 10, 27, 4, 0, 0)
const HK_TODAY_START = Date.UTC(2026, 10, 26, 16, 0, 0) // HK 今日 00:00
const MS_PER_DAY = 24 * 60 * 60 * 1000

let seq = 0
function task(overrides: Partial<TaskRow> = {}): TaskRow {
  seq += 1
  return {
    id: `t${seq}`,
    category: 'work',
    completed_at: null,
    created_at: '2026-11-20T02:00:00.000Z',
    deleted_at: null,
    due_date: null,
    notes: '',
    pinned: false,
    priority: 'medium',
    source: 'web',
    source_ref: null,
    status: 'todo',
    tags: [],
    title: `任務 ${seq}`,
    updated_at: '2026-11-20T02:00:00.000Z',
    ...overrides,
  }
}

describe('isVisibleTask', () => {
  it('deleted_at 非 NULL 一律隱藏', () => {
    expect(isVisibleTask(task({ deleted_at: '2026-11-26T01:00:00.000Z' }), NOW)).toBe(false)
  })

  it('status 非 done 永遠可見（即使殘留舊 completed_at）', () => {
    expect(isVisibleTask(task({ status: 'todo', completed_at: '2026-11-01T00:00:00.000Z' }), NOW)).toBe(true)
    expect(isVisibleTask(task({ status: 'park' }), NOW)).toBe(true)
  })

  it('昨日 done 隱藏', () => {
    const row = task({ status: 'done', completed_at: '2026-11-26T10:00:00.000Z' })
    expect(isVisibleTask(row, NOW)).toBe(false)
  })

  it('今日 done 可見', () => {
    // HK 今日 10:00 = 02:00Z
    const row = task({ status: 'done', completed_at: '2026-11-27T02:00:00.000Z' })
    expect(isVisibleTask(row, NOW)).toBe(true)
  })

  it('completed_at = 今日 00:00（含下界）可見', () => {
    const row = task({ status: 'done', completed_at: new Date(HK_TODAY_START).toISOString() })
    expect(isVisibleTask(row, NOW)).toBe(true)
  })

  it('completed_at = 翌日 00:00（不含上界）隱藏', () => {
    const row = task({ status: 'done', completed_at: new Date(HK_TODAY_START + MS_PER_DAY).toISOString() })
    expect(isVisibleTask(row, NOW)).toBe(false)
  })

  it('done 而 completed_at NULL（防禦）隱藏', () => {
    expect(isVisibleTask(task({ status: 'done', completed_at: null }), NOW)).toBe(false)
  })
})

describe('compareTasks / sortTasks', () => {
  it('pinned low 贏非 pinned critical', () => {
    const pinnedLow = task({ pinned: true, priority: 'low' })
    const critical = task({ priority: 'critical' })
    expect(sortTasks([critical, pinnedLow])).toEqual([pinnedLow, critical])
  })

  it('park 贏非 pinned critical todo', () => {
    const park = task({ status: 'park', priority: 'low' })
    const critical = task({ status: 'todo', priority: 'critical' })
    expect(sortTasks([critical, park])[0]).toBe(park)
  })

  it('pinned 優先過 park（逐級比較）', () => {
    const pinnedTodo = task({ pinned: true, status: 'todo' })
    const park = task({ status: 'park' })
    expect(sortTasks([park, pinnedTodo])[0]).toBe(pinnedTodo)
  })

  it('priority 次序 critical > high > medium > low', () => {
    const low = task({ priority: 'low' })
    const medium = task({ priority: 'medium' })
    const high = task({ priority: 'high' })
    const critical = task({ priority: 'critical' })
    expect(sortTasks([low, medium, high, critical])).toEqual([critical, high, medium, low])
  })

  it('同 priority：due_date 近者先', () => {
    const sooner = task({ due_date: '2026-11-28' })
    const later = task({ due_date: '2026-12-01' })
    expect(sortTasks([later, sooner])).toEqual([sooner, later])
  })

  it('due NULL 排同級最後', () => {
    const withDue = task({ due_date: '2026-12-01' })
    const noDue = task({ due_date: null })
    expect(sortTasks([noDue, withDue])).toEqual([withDue, noDue])
  })

  it('同級同 due：created_at 新者先（epoch 比較）', () => {
    const older = task({ created_at: '2026-11-20T02:00:00.000Z' })
    const newer = task({ created_at: '2026-11-26T14:00:00.000+00:00' }) // 非標準時區格式
    expect(sortTasks([older, newer])).toEqual([newer, older])
  })

  it('今日 done 排最後；done 群內 completed_at 新者先', () => {
    const doneOld = task({ status: 'done', completed_at: '2026-11-27T01:00:00.000Z' }) // HK 09:00
    const doneNew = task({ status: 'done', completed_at: '2026-11-27T03:00:00.000Z' }) // HK 11:00
    const critical = task({ priority: 'critical' })
    expect(sortTasks([doneNew, critical, doneOld])).toEqual([critical, doneNew, doneOld])
  })

  it('done 不因 pinned 跳前：pinned done 仍排非 done 之後', () => {
    const pinnedDone = task({ pinned: true, status: 'done', completed_at: '2026-11-27T02:00:00.000Z' })
    const plain = task({})
    expect(sortTasks([pinnedDone, plain])).toEqual([plain, pinnedDone])
  })

  it('compareTasks 對完全相同嘅列回 0（sort 穩定）', () => {
    const a = task({})
    const b = task({ ...a, id: 'clone' })
    expect(compareTasks(a, b)).toBe(0)
  })

  it('sortTasks 唔 mutate 輸入陣列', () => {
    const a = task({ priority: 'low' })
    const b = task({ priority: 'critical' })
    const input = [a, b]
    sortTasks(input)
    expect(input).toEqual([a, b])
  })
})

describe('toggleStatus（R3-1）', () => {
  it('done → todo', () => {
    expect(toggleStatus('done')).toBe('todo')
  })

  it('todo → done', () => {
    expect(toggleStatus('todo')).toBe('done')
  })

  it('park → done', () => {
    expect(toggleStatus('park')).toBe('done')
  })

  it('park → done → 取消 → todo（唔還原 park）', () => {
    expect(toggleStatus(toggleStatus('park'))).toBe('todo')
  })
})

describe('tagUsageCounts（R1-5）', () => {
  it('計入舊 done 任務，排除軟刪任務', () => {
    const doneOld = task({
      status: 'done',
      completed_at: '2026-11-25T02:00:00.000Z',
      tags: ['SEN'],
    })
    const deleted = task({ deleted_at: '2026-11-26T01:00:00.000Z', tags: ['PSMCD'] })
    const live = task({ tags: ['SEN', '學教組'] })
    const counts = tagUsageCounts([doneOld, deleted, live])
    expect(counts.get('SEN')).toBe(2)
    expect(counts.get('學教組')).toBe(1)
    expect(counts.has('PSMCD')).toBe(false)
  })

  it('空輸入回空 Map', () => {
    expect(tagUsageCounts([]).size).toBe(0)
  })
})
