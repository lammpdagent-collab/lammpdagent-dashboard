import { describe, expect, it } from 'vitest'
import { hasEnv, readEnv } from '../src/lib/env'

describe('readEnv', () => {
  it('有值時原樣回傳', () => {
    expect(readEnv({ A: 'x' }, 'A')).toBe('x')
  })

  it('缺失時拋錯並講明 key', () => {
    expect(() => readEnv({}, 'MISSING')).toThrow(/MISSING/)
  })

  it('空白字串當缺失', () => {
    expect(() => readEnv({ A: '   ' }, 'A')).toThrow(/A/)
  })
})

describe('hasEnv', () => {
  it('有值 true', () => {
    expect(hasEnv({ A: 'x' }, 'A')).toBe(true)
  })

  it('缺失或空白 false', () => {
    expect(hasEnv({}, 'A')).toBe(false)
    expect(hasEnv({ A: '' }, 'A')).toBe(false)
  })
})
