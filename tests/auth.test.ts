import { describe, expect, it } from 'vitest'
import { resolveView } from '../src/lib/auth'

describe('resolveView（認證閘狀態機）', () => {
  it('無 session → login（不論 ownerCheck；未登入前根本未查 owner）', () => {
    expect(resolveView(false, null)).toBe('login')
    expect(resolveView(false, true)).toBe('login')
    expect(resolveView(false, false)).toBe('login')
    expect(resolveView(false, 'error')).toBe('login')
  })

  it('session + ownerCheck=null（未查／查詢中）→ loading', () => {
    expect(resolveView(true, null)).toBe('loading')
  })

  it('session + owner=true → ready（入場，可以 loadAll）', () => {
    expect(resolveView(true, true)).toBe('ready')
  })

  it('session + notOwner（RPC 回 false）→ blocked（「無法存取」）', () => {
    expect(resolveView(true, false)).toBe('blocked')
  })

  it('session + ownerCheck 失敗（RPC 呼叫本身出錯）→ error（可重試）', () => {
    expect(resolveView(true, 'error')).toBe('error')
  })

  it('五個 view 值齊晒；同參數結果穩定', () => {
    const views = new Set([
      resolveView(false, null),
      resolveView(true, null),
      resolveView(true, true),
      resolveView(true, false),
      resolveView(true, 'error'),
    ])
    expect(views).toEqual(new Set(['login', 'loading', 'ready', 'blocked', 'error']))
    expect(resolveView(true, true)).toBe('ready') // 再查一次，純函式無狀態
  })
})
