import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_LEN,
  MAX_NAME_LEN,
  codePointLength,
  formatTimestamp,
  normaliseRow,
  validateMessage,
} from '../src/lib/guestbook'

describe('codePointLength', () => {
  it('一般字串逐個 code point 計', () => {
    expect(codePointLength('abc')).toBe(3)
  })

  it('emoji 算一個 code point（唔係 UTF-16 unit）', () => {
    // UTF-16 `.length` 係 2 —— 斷言緊 code point 而非 unit
    expect('👍'.length).toBe(2)
    expect(codePointLength('👍')).toBe(1)
  })

  it('夾埋 emoji 都照計', () => {
    expect(codePointLength('a👍b')).toBe(3)
  })

  it('唔偷偷 trim：頭尾空白照計（trim 由 caller 負責）', () => {
    expect(codePointLength(' a ')).toBe(3)
  })
})

describe('validateMessage', () => {
  it('有效輸入：trim 完回傳（儲存用）', () => {
    expect(validateMessage('  小明 ', ' 你好 ')).toEqual({
      ok: true,
      name: '小明',
      message: '你好',
    })
  })

  it('空白暱稱（"" 同全空白）：errors.name 有訊息，errors.message 冇 key', () => {
    for (const raw of ['', '   ']) {
      const result = validateMessage(raw, '你好')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.name).toBeTruthy()
        expect(result.errors.message).toBeUndefined()
      }
    }
  })

  it('空白內容：errors.message 有訊息，errors.name 冇 key', () => {
    const result = validateMessage('小明', '   ')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.message).toBeTruthy()
      expect(result.errors.name).toBeUndefined()
    }
  })

  it('兩欄同時空白：兩個 key 都有訊息', () => {
    const result = validateMessage('', '')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.name).toBeTruthy()
      expect(result.errors.message).toBeTruthy()
    }
  })

  it('純 zero-width 字元（U+200B）當空白：errors.name 有訊息', () => {
    const result = validateMessage('\u200b', 'ok')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.name).toBeTruthy()
      expect(result.errors.message).toBeUndefined()
    }
  })

  it('其餘 zero-width 字元（180E／200C／200D／2060／FEFF，連埋空白）都當空白', () => {
    for (const raw of ['\u180e', '\u200c', '\u200d', '\u2060', '\ufeff', '  \u200b  ']) {
      const result = validateMessage(raw, 'ok')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.name).toBeTruthy()
    }
    // 內容欄同樣處理
    const result = validateMessage('ok', '\u200b\u2060\ufeff')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.message).toBeTruthy()
      expect(result.errors.name).toBeUndefined()
    }
  })

  it('尾端 ZWSP 被清走（對齊 DB btrim）：name 回「abc」', () => {
    const result = validateMessage('abc\u200b', 'ok')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.name).toBe('abc')
  })

  it('首端 ZWSP 被清走：name 回「abc」', () => {
    const result = validateMessage('\u200babc', 'ok')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.name).toBe('abc')
  })

  it('內容尾端 WORD JOINER（U+2060）被清走：message 回「你好」', () => {
    const result = validateMessage('ok', '你好\u2060')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toBe('你好')
  })

  it('zero-width 夾喺可見字元之間照計長度（唔當空白）', () => {
    const result = validateMessage('a\u200bb', 'ok')
    expect(result.ok).toBe(true)
  })

  it('暱稱 30 個字係上限內', () => {
    expect(validateMessage('a'.repeat(MAX_NAME_LEN), 'ok').ok).toBe(true)
  })

  it('暱稱 31 個字超限', () => {
    const result = validateMessage('a'.repeat(MAX_NAME_LEN + 1), 'ok')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toBeTruthy()
  })

  it('內容 500 個字係上限內', () => {
    expect(validateMessage('ok', 'x'.repeat(MAX_MESSAGE_LEN)).ok).toBe(true)
  })

  it('內容 501 個字超限', () => {
    const result = validateMessage('ok', 'x'.repeat(MAX_MESSAGE_LEN + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.message).toBeTruthy()
  })

  it('emoji 按 code point 計：30 個 👍（UTF-16 60 units）都合法', () => {
    expect(validateMessage('👍'.repeat(MAX_NAME_LEN), 'ok').ok).toBe(true)
  })

  it('emoji 上限都按 code point 計：31 個 👍 做暱稱被拒', () => {
    const result = validateMessage('👍'.repeat(MAX_NAME_LEN + 1), 'ok')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toBeTruthy()
  })
})

describe('formatTimestamp', () => {
  it('固定以香港時間（UTC+8）顯示；用 component 斷言，唔 exact-match 成句', () => {
    const out = formatTimestamp(new Date('2026-01-15T08:30:00Z'))
    expect(out).toContain('2026')
    expect(out).toContain('下午')
    expect(out).toContain('4:30')
  })
})

describe('normaliseRow', () => {
  it('完整 row 轉做 entry，createdAt 係 Date', () => {
    const entry = normaliseRow({
      id: 7,
      name: '小明',
      message: '你好',
      created_at: '2026-01-15T08:30:00Z',
    })
    expect(entry).not.toBeNull()
    expect(entry?.id).toBe(7)
    expect(entry?.name).toBe('小明')
    expect(entry?.message).toBe('你好')
    expect(entry?.createdAt.getTime()).toBe(Date.parse('2026-01-15T08:30:00Z'))
  })

  it('缺欄位回 null', () => {
    expect(normaliseRow({ id: 1, name: 'a', message: 'b' })).toBeNull()
  })

  it('undefined（同 null）回 null', () => {
    expect(normaliseRow(undefined)).toBeNull()
    expect(normaliseRow(null)).toBeNull()
  })

  it('created_at 唔係合法日期回 null', () => {
    expect(
      normaliseRow({ id: 1, name: 'a', message: 'b', created_at: 'not-a-date' }),
    ).toBeNull()
  })
})
