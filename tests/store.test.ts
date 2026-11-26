import { describe, expect, it } from 'vitest'
import { createInitialState, createStore, optimisticUpdate, type Store } from '../src/lib/store'
import type { TaskRow } from '../src/lib/types'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    title: '舊標題',
    notes: '',
    due_date: null,
    priority: 'medium',
    category: 'work',
    status: 'todo',
    pinned: false,
    tags: [],
    source: 'web',
    source_ref: null,
    created_at: '2026-11-26T00:00:00.000Z',
    updated_at: '2026-11-26T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function storeWith(rows: TaskRow[]): Store {
  const store = createStore({ ...createInitialState(), tasks: rows })
  return store
}

describe('optimisticUpdate rollback（m7：只還原 patch 涉及嘅 key）', () => {
  it('rollback 只還原被 patch 嘅欄位，保留其他 in-flight／已成功嘅修改', async () => {
    const store = storeWith([task()])
    // 第一個 patch（tags）成功
    await optimisticUpdate(store, 't1', { tags: ['SEN'] }, () => Promise.resolve())
    // 第二個 patch（title）失敗——唔可以連成功咗嘅 tags 一齊沖走
    const ok = await optimisticUpdate(store, 't1', { title: '新標題' }, () =>
      Promise.reject(new Error('network')),
    )
    expect(ok).toBe(false)
    const row = store.getState().tasks.find((t) => t.id === 't1')
    expect(row?.title).toBe('舊標題') // 失敗嘅 title 還原
    expect(row?.tags).toEqual(['SEN']) // 之前成功嘅 tags 保留（m7）
    expect(row?.status).toBe('todo')
  })

  it('rollback 多個 key 時逐個 key 還原', async () => {
    const store = storeWith([task({ priority: 'low', due_date: '2026-12-01' })])
    await optimisticUpdate(
      store,
      't1',
      { priority: 'high', due_date: '2026-12-05', pinned: true },
      () => Promise.reject(new Error('rejected')),
    )
    const row = store.getState().tasks.find((t) => t.id === 't1')
    expect(row?.priority).toBe('low')
    expect(row?.due_date).toBe('2026-12-01')
    expect(row?.pinned).toBe(false)
  })

  it('行已唔喺列表（realtime merge 移走）→ 照舊還原返 patch 前快照', async () => {
    const store = storeWith([task()])
    const ok = await optimisticUpdate(store, 't1', { status: 'done' }, () =>
      Promise.reject(new Error('network')),
    )
    expect(ok).toBe(false)
    // optimistic apply 時未移除（非 soft delete）→ rollback 應該還原 status
    expect(store.getState().tasks.find((t) => t.id === 't1')?.status).toBe('todo')
  })

  it('soft delete 失敗 → 行插返入列表', async () => {
    const store = storeWith([task()])
    const ok = await optimisticUpdate(store, 't1', { deleted_at: '2026-11-27T01:00:00.000Z' }, () =>
      Promise.reject(new Error('network')),
    )
    expect(ok).toBe(false)
    expect(store.getState().tasks.some((t) => t.id === 't1')).toBe(true)
    expect(store.getState().tasks[0]?.deleted_at).toBeNull()
  })
})

describe('optimisticUpdate persistPatch（NIT5：本地 patch 同 DB patch 分離）', () => {
  it('本地多帶 completed_at 唔會送 DB；DB 只收到 persistPatch', async () => {
    const store = storeWith([task()])
    const sent: Array<Record<string, unknown>> = []
    const ok = await optimisticUpdate(
      store,
      't1',
      { status: 'done', completed_at: '2026-11-27T02:00:00.000Z' },
      (p) => {
        sent.push(p as Record<string, unknown>)
        return Promise.resolve()
      },
      { status: 'done' },
    )
    expect(ok).toBe(true)
    expect(sent).toEqual([{ status: 'done' }]) // completed_at 冇入 DB patch
    const row = store.getState().tasks.find((t) => t.id === 't1')
    expect(row?.status).toBe('done')
    expect(row?.completed_at).toBe('2026-11-27T02:00:00.000Z') // 本地即刻有（NIT5）
  })

  it('persistPatch 分離時 rollback：本地多帶嘅 completed_at 都會還原', async () => {
    const store = storeWith([task({ completed_at: null })])
    const ok = await optimisticUpdate(
      store,
      't1',
      { status: 'todo', completed_at: null },
      () => Promise.reject(new Error('network')),
      { status: 'todo' },
    )
    expect(ok).toBe(false)
    const row = store.getState().tasks.find((t) => t.id === 't1')
    expect(row?.status).toBe('todo') // 還原（patch 前值）
    expect(row?.completed_at).toBeNull()
  })
})
