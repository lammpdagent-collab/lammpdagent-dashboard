import { describe, expect, it } from 'vitest'
import { fetchLatest, insertMessage, type MessageClient } from '../src/lib/repository'

/**
 * 假 client：from(table) 記錄 table 名並回 builder；
 * select(str) 記錄欄位字串；order(col, opts) 記錄兩個參數；
 * limit(n) 記錄 n 並回 Promise；insert(payload) 記錄 payload 並回 Promise。
 */
function makeFakeClient(
  result: { data: unknown[] | null; error: unknown } = { data: [], error: null },
) {
  const calls = {
    tables: [] as string[],
    selectColumns: '',
    orderArgs: [] as Array<{ column: string; options: { ascending?: boolean } }>,
    limitCount: null as number | null,
    insertPayloads: [] as unknown[],
  }
  const builder = {
    select(columns: string) {
      calls.selectColumns = columns
      return this
    },
    order(column: string, options: { ascending?: boolean }) {
      calls.orderArgs.push({ column, options })
      return this
    },
    limit(count: number) {
      calls.limitCount = count
      return Promise.resolve({ data: result.data, error: result.error })
    },
    insert(payload: unknown) {
      calls.insertPayloads.push(payload)
      return Promise.resolve({ data: null, error: result.error })
    },
  }
  const client = {
    from(table: string) {
      calls.tables.push(table)
      return builder
    },
  }
  return { client: client as unknown as MessageClient, calls }
}

describe('fetchLatest', () => {
  it('呼叫形狀：from("messages")、select 含 created_at、order created_at 由新至舊、limit 3（預設）', async () => {
    const { client, calls } = makeFakeClient({
      data: [
        { id: 2, name: '乙', message: '第二條', created_at: '2026-01-02T00:00:00Z' },
        { id: 1, name: '甲', message: '第一條', created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    })
    const entries = await fetchLatest(client)
    expect(calls.tables).toEqual(['messages'])
    expect(calls.selectColumns).toContain('created_at')
    expect(calls.orderArgs).toEqual([{ column: 'created_at', options: { ascending: false } }])
    expect(calls.limitCount).toBe(3)
    expect(entries.map((entry) => entry.id)).toEqual([2, 1])
    expect(entries[0]?.createdAt.getTime()).toBe(Date.parse('2026-01-02T00:00:00Z'))
  })

  it('注入 limit 1 時照用', async () => {
    const { client, calls } = makeFakeClient({
      data: [{ id: 9, name: '甲', message: 'hi', created_at: '2026-01-01T00:00:00Z' }],
      error: null,
    })
    const entries = await fetchLatest(client, 1)
    expect(calls.limitCount).toBe(1)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('甲')
  })

  it('data 係 null 且冇 error → 回空陣列', async () => {
    const { client } = makeFakeClient({ data: null, error: null })
    expect(await fetchLatest(client)).toEqual([])
  })

  it('error 非 null → 拋錯（Supabase error 向上拋）', async () => {
    const { client } = makeFakeClient({ data: null, error: { message: 'boom', code: '42P01' } })
    await expect(fetchLatest(client)).rejects.toThrow(/載入留言失敗/)
  })

  it('拋出嘅 Error `cause` 係原本嘅 error 物件', async () => {
    const original = { message: 'boom', code: '42P01' }
    const { client } = makeFakeClient({ data: null, error: original })
    let caught: unknown
    try {
      await fetchLatest(client)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error & { cause: unknown }).cause).toBe(original)
  })

  it('data 含 invalid row（created_at 無法 parse，例如 infinity）會被濾走，其餘保留', async () => {
    const { client } = makeFakeClient({
      data: [
        { id: 3, name: '丙', message: '第三條', created_at: 'infinity' },
        { id: 2, name: '乙', message: '第二條', created_at: '2026-01-02T00:00:00Z' },
      ],
      error: null,
    })
    const entries = await fetchLatest(client)
    expect(entries.map((entry) => entry.id)).toEqual([2])
  })
})

describe('insertMessage', () => {
  it('payload 只有 name 同 message（冇 id／created_at，唔會撞 identity 欄）', async () => {
    const { client, calls } = makeFakeClient({ data: null, error: null })
    await insertMessage(client, { name: '小明', message: '你好' })
    expect(calls.tables).toEqual(['messages'])
    expect(calls.insertPayloads).toEqual([{ name: '小明', message: '你好' }])
  })

  it('insert error 非 null → 拋錯', async () => {
    const { client } = makeFakeClient({ data: null, error: { message: 'boom' } })
    await expect(insertMessage(client, { name: 'a', message: 'b' })).rejects.toThrow()
  })
})
