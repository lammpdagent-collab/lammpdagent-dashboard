import { describe, expect, it } from 'vitest'
import { isDraftDirty } from '../src/lib/draft'

// N9：M2 嘅草稿 dirty 判斷——原本喺 main.ts captureFocus 內，抽到 lib 補測試。
describe('isDraftDirty（M2/N9）', () => {
  it('用戶手打過（field ≠ state）且 state 冇變（state == baseline）→ dirty，保留草稿', () => {
    expect(isDraftDirty('打緊嘅草稿', '原標題', '原標題')).toBe(true)
  })

  it('冇打字（field == state）→ 唔 dirty', () => {
    expect(isDraftDirty('原標題', '原標題', '原標題')).toBe(false)
  })

  it('state 已變（rollback／遠端更新，state ≠ baseline）→ 唔 dirty，唔好將失敗值寫返上 DOM', () => {
    // rollback 之後 state 返返原值，但 baseline 仲係更早 capture 嘅值——
    // 表示 state 變過（rollback／遠端更新），元素值唔可以當草稿還原。
    expect(isDraftDirty('失敗值', '原標題', '更早嘅值')).toBe(false)
  })
})
