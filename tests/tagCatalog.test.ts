import { describe, expect, it } from 'vitest'
import {
  TAG_NAME_ERROR,
  orderTagsForTask,
  rowsWithTag,
  stripTag,
  toggleTagOnTask,
  validateTagName,
} from '../src/lib/tagCatalog'
import type { TagRow } from '../src/lib/types'

let seq = 0
function tag(name: string): TagRow {
  seq += 1
  return { name, created_at: `2026-11-20T0${seq % 10}:00:00.000Z` }
}

const usage = new Map<string, number>([
  ['PSMCD', 5],
  ['學教組', 3],
  ['SEN', 1],
])

describe('orderTagsForTask', () => {
  const catalog = [tag('PSMCD'), tag('SEN'), tag('學教組')]

  it('{SEN} 置前並標 selected，其餘按使用次數排序', () => {
    expect(orderTagsForTask(['SEN'], catalog, usage)).toEqual([
      { name: 'SEN', selected: true },
      { name: 'PSMCD', selected: false },
      { name: '學教組', selected: false },
    ])
  })

  it('無已選時全部按 usage 降序', () => {
    expect(orderTagsForTask([], catalog, usage).map((c) => c.name)).toEqual([
      'PSMCD',
      '學教組',
      'SEN',
    ])
  })

  it('同次數 tie-break zh-Hant 字母序', () => {
    const equal = new Map<string, number>([
      ['beta', 2],
      ['alpha', 2],
    ])
    const cats = [tag('beta'), tag('alpha')]
    expect(orderTagsForTask([], cats, equal).map((c) => c.name)).toEqual(['alpha', 'beta'])
  })

  it('目錄無嘅 tag（已刪目錄行）只要任務已選仍顯示 selected', () => {
    const orphan = orderTagsForTask(['孤兒tag'], [], usage)
    expect(orphan).toEqual([{ name: '孤兒tag', selected: true }])
  })

  it('usage 無記錄當 0，排群內最後', () => {
    const cats = [tag('新tag'), tag('PSMCD')]
    const result = orderTagsForTask([], cats, usage)
    expect(result.map((c) => c.name)).toEqual(['PSMCD', '新tag'])
  })

  it('重複選取去重', () => {
    const result = orderTagsForTask(['SEN', 'SEN'], catalog, usage)
    expect(result.filter((c) => c.name === 'SEN')).toHaveLength(1)
  })
})

describe('toggleTagOnTask', () => {
  it('未選 → 加入（回新陣列）', () => {
    const t = { tags: ['SEN'] }
    expect(toggleTagOnTask(t, '學教組')).toEqual(['SEN', '學教組'])
  })

  it('已選 → 移除', () => {
    const t = { tags: ['SEN', '學教組'] }
    expect(toggleTagOnTask(t, 'SEN')).toEqual(['學教組'])
  })

  it('純函式：唔 mutate 輸入', () => {
    const tags = ['SEN']
    const t = { tags }
    const next = toggleTagOnTask(t, 'PSMCD')
    expect(t.tags).toEqual(['SEN'])
    expect(tags).toEqual(['SEN'])
    expect(next).not.toBe(tags)
  })
})

describe('validateTagName', () => {
  it('trim 後有效 → null', () => {
    expect(validateTagName('  SEN  ')).toBeNull()
    expect(validateTagName('學教組')).toBeNull()
  })

  it('trim 後空串拒絕', () => {
    expect(validateTagName('')).toBe(TAG_NAME_ERROR)
    expect(validateTagName('   ')).toBe(TAG_NAME_ERROR)
  })

  it('邊界：40 字元有效、41 拒絕', () => {
    expect(validateTagName('x'.repeat(40))).toBeNull()
    expect(validateTagName('x'.repeat(41))).toBe(TAG_NAME_ERROR)
  })

  it('錯誤文案', () => {
    expect(TAG_NAME_ERROR).toBe('標籤長度須為 1–40 字元')
  })
})

describe('stripTag（R1-4 array_remove 等價）', () => {
  it('只回有變嘅行，行內同名 tag 全部移除', () => {
    const rows = [
      { id: 'a', tags: ['X', 'Y'] },
      { id: 'b', tags: ['Y'] },
      { id: 'c', tags: ['X', 'X', 'Z'] },
    ]
    expect(stripTag(rows, 'X')).toEqual([
      { id: 'a', tags: ['Y'] },
      { id: 'c', tags: ['Z'] },
    ])
  })

  it('無關行唔出現喺結果，原陣列不變', () => {
    const b = { id: 'b', tags: ['Y'] }
    const rows = [{ id: 'a', tags: ['X'] }, b]
    expect(stripTag(rows, 'X')).toEqual([{ id: 'a', tags: [] }])
    expect(b.tags).toEqual(['Y'])
  })

  it('全部無關 → 空陣列', () => {
    expect(stripTag([{ id: 'a', tags: ['Y'] }], 'X')).toEqual([])
  })
})

describe('rowsWithTag（m3：tag 名含特殊字元，本地過濾代替 PostgREST cs）', () => {
  it('含逗號 tag 名照樣過濾到', () => {
    const rows = [
      { id: 'a', tags: ['a,b'] },
      { id: 'b', tags: ['a'] },
      { id: 'c', tags: ['b', 'a,b', 'x}y', 'q"z'] },
    ]
    expect(rowsWithTag(rows, 'a,b').map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('含 } 同 " 嘅 tag 名都唔會被誤拆', () => {
    const rows = [{ id: 'a', tags: ['x}y'] }, { id: 'b', tags: ['q"z'] }, { id: 'c', tags: ['xy'] }]
    expect(rowsWithTag(rows, 'x}y').map((r) => r.id)).toEqual(['a'])
    expect(rowsWithTag(rows, 'q"z').map((r) => r.id)).toEqual(['b'])
  })

  it('精確整項比對：部分字串相同唔算', () => {
    const rows = [{ id: 'a', tags: ['ab', 'a,b'] }]
    expect(rowsWithTag(rows, 'a,b').map((r) => r.id)).toEqual(['a'])
    expect(rowsWithTag(rows, 'ab').map((r) => r.id)).toEqual(['a'])
    expect(rowsWithTag(rows, 'b')).toEqual([])
  })
})
