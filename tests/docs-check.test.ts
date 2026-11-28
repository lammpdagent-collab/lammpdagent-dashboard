// tests/docs-check.test.ts — docs-check 純邏輯測試
//
// 原則（design.md「測試策略」）：全部用 fixture / 合成資料，
// 唔斷言真實檔案系統的當前狀態（那是 `npm run docs:check` 自己的工作）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DocCheckError,
  checkRuntimePath,
  checkSpecPath,
  classifyPath,
  extractBacktickTokens,
  findSkillDir,
  hashValue,
  isPathLikeToken,
  isValidCronExpr,
  parseSection4,
  resolveL4Path,
  resolveSpecPath,
  stableStringify,
  validateJobs,
  type Section4Row,
} from '../scripts/docs-check.ts'

// ---------------------------------------------------------------------------
// fixture 目錄（每個 test 自建自清，唔掂真實 repo / profile 檔案）
// ---------------------------------------------------------------------------

const TMP_ROOTS: string[] = []

function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'docs-check-test-'))
  TMP_ROOTS.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of TMP_ROOTS.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// §4 表格 fixture（照 SYSTEM.md §4 的真實形狀砌，但內容係合成）
// ---------------------------------------------------------------------------

const GOOD_MD = [
  '# SYSTEM.md',
  '',
  '## 4. Spec ↔ Runtime 對應表（核心）',
  '',
  '| Spec（L3）| Runtime 實作（L4 / L3 code）| 其他受影響 |',
  '|---|---|---|',
  '| `specs/foo/spec.md`（2 req）| `skills/foo/SKILL.md` 全部<br>`briefing/fetch.ts`（時間窗）<br>**`briefing/relevance.ts`**（主角）| cron `abc123def456`（0700）；`SOUL.md` MODE 2 |',
  '| `specs/bar/spec.md`（3 req）| `SOUL.md` MODE 3 + `skills/foo/SKILL.md`（`manual（query mode）`）| `briefing/fetch.ts --mode query` |',
  '',
  '## 5. 下一段',
  '',
  '內容。',
].join('\n')

describe('parseSection4', () => {
  it('正常表格：抽出 3 欄、行號、backtick token（含 <br> 同粗體包住的）', () => {
    const table = parseSection4(GOOD_MD)
    expect(table.rows).toHaveLength(2)

    const row1: Section4Row = table.rows[0]!
    expect(row1.lineNo).toBe(7)
    expect(row1.specTokens).toEqual(['specs/foo/spec.md'])
    expect(row1.runtimeTokens).toEqual(['skills/foo/SKILL.md', 'briefing/fetch.ts', 'briefing/relevance.ts'])
    expect(row1.otherCell).toContain('cron')

    const row2: Section4Row = table.rows[1]!
    expect(row2.lineNo).toBe(8)
    // `manual（query mode）` 係 backtick token 但唔係路徑 —— 照抽出，由 isPathLikeToken 過濾
    expect(row2.runtimeTokens).toContain('manual（query mode）')
    expect(row2.runtimeTokens).toContain('SOUL.md')
  })

  it('CRLF 行尾一樣解析到', () => {
    const table = parseSection4(GOOD_MD.split('\n').join('\r\n'))
    expect(table.rows).toHaveLength(2)
  })

  it('表格喺檔案結尾（冇後續章節）都解析到', () => {
    const content = ['## 4. 對應表', '', '| A | B | C |', '|---|---|---|', '| `specs/x/spec.md` | `a.ts` | — |'].join('\n')
    const table = parseSection4(content)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]!.specTokens).toEqual(['specs/x/spec.md'])
  })

  it('缺 `## 4.` 章節 → DocCheckError（防靜默跳過）', () => {
    const content = ['# SYSTEM.md', '', '## 1. 其他', '', '| A | B | C |', '|---|---|---|', '| `x` | `y` | `z` |'].join('\n')
    expect(() => parseSection4(content)).toThrow(DocCheckError)
    expect(() => parseSection4(content)).toThrow(/§4/)
  })

  it('章節存在但冇表格 → DocCheckError', () => {
    const content = ['## 4. 對應表', '', '只有文字，冇表格。'].join('\n')
    expect(() => parseSection4(content)).toThrow(DocCheckError)
    expect(() => parseSection4(content)).toThrow(/表格/)
  })

  it('資料行欄位數唔對 → DocCheckError，訊息帶行號同行內容', () => {
    const content = [
      '## 4. 對應表',
      '',
      '| A | B | C |',
      '|---|---|---|',
      '| `specs/x/spec.md` | `a.ts` |',
    ].join('\n')
    try {
      parseSection4(content)
      expect.unreachable('應該擲 DocCheckError')
    } catch (err) {
      expect(err).toBeInstanceOf(DocCheckError)
      expect((err as Error).message).toContain('欄位數')
      expect((err as Error).message).toContain('第 5 行')
      expect((err as Error).message).toContain('`specs/x/spec.md`')
    }
  })

  it('header 欄位數唔對 → DocCheckError', () => {
    const content = ['## 4. 對應表', '', '| A | B | C | D |', '|---|---|---|---|', '| `x` | `y` | `z` | `w` |'].join('\n')
    expect(() => parseSection4(content)).toThrow(DocCheckError)
  })

  it('分隔行唔係 |---| → DocCheckError', () => {
    const content = ['## 4. 對應表', '', '| A | B | C |', '| a | b | c |', '| `x` | `y` | `z` |'].join('\n')
    expect(() => parseSection4(content)).toThrow(DocCheckError)
  })
})

describe('extractBacktickTokens', () => {
  it('抽齊所有 backtick token', () => {
    expect(extractBacktickTokens('`a.ts` 同 `b/c.md`；**`d.ts`**')).toEqual(['a.ts', 'b/c.md', 'd.ts'])
  })

  it('冇 backtick → 空陣列', () => {
    expect(extractBacktickTokens('純文字')).toEqual([])
  })
})

describe('classifyPath / isPathLikeToken', () => {
  it('L4 前綴：skills/、SOUL.md、cron/、config.yaml、scripts/', () => {
    expect(classifyPath('skills/daily-briefing/SKILL.md')).toBe('L4')
    expect(classifyPath('skills/note-taking/school-calendar-sync')).toBe('L4')
    expect(classifyPath('SOUL.md')).toBe('L4')
    expect(classifyPath('cron/jobs.json')).toBe('L4')
    expect(classifyPath('config.yaml')).toBe('L4')
    expect(classifyPath('scripts/school_cal_monitor.py')).toBe('L4')
  })

  it('其他一律 L3（含 n8n/ —— 兩者都唔係 L4 前綴）', () => {
    expect(classifyPath('src/lib/taskQuery.ts')).toBe('L3')
    expect(classifyPath('briefing/fetch.ts')).toBe('L3')
    expect(classifyPath('n8n/workflows/calendar-sync.json')).toBe('L3')
    expect(classifyPath('openspec/specs/daily-briefing/spec.md')).toBe('L3')
  })

  it('係路徑嘅 token', () => {
    expect(isPathLikeToken('briefing/fetch.ts')).toBe(true)
    expect(isPathLikeToken('SOUL.md')).toBe(true)
    expect(isPathLikeToken('config.yaml')).toBe(true)
    expect(isPathLikeToken('src/main.ts')).toBe(true)
  })

  it('唔係路徑嘅 token（§4 內真實出現嘅形態）→ false', () => {
    expect(isPathLikeToken('manual（query mode）')).toBe(false)
    expect(isPathLikeToken('43e12b7b639e')).toBe(false)
    expect(isPathLikeToken('sync')).toBe(false)
    expect(isPathLikeToken('MODE 3')).toBe(false)
  })
})

describe('路徑解析（resolveSpecPath / resolveL4Path / checkSpecPath / checkRuntimePath）', () => {
  it('resolveSpecPath：specs/<cap>/spec.md → <repo>/openspec/specs/<cap>/spec.md', () => {
    expect(resolveSpecPath('/repo', 'specs/foo/spec.md')).toBe(path.join('/repo', 'openspec', 'specs/foo/spec.md'))
    expect(resolveSpecPath('/repo', 'openspec/specs/foo/spec.md')).toBe(path.join('/repo', 'openspec/specs/foo/spec.md'))
  })

  it('resolveL4Path：已含子目錄嘅 token 直接接上去', () => {
    const got = resolveL4Path('skills/note-taking/school-calendar-sync', '/profiles')
    expect(got).toBe(path.join('/profiles', 'personal-assistant', 'skills/note-taking/school-calendar-sync'))
  })

  it('fixture：spec 存在 / 唔存在', () => {
    const root = makeTmp()
    mkdirSync(path.join(root, 'openspec', 'specs', 'foo'), { recursive: true })
    writeFileSync(path.join(root, 'openspec', 'specs', 'foo', 'spec.md'), '# foo\n')
    expect(checkSpecPath(root, 'specs/foo/spec.md')).toMatchObject({ ok: true })
    expect(checkSpecPath(root, 'specs/bar/spec.md').ok).toBe(false)
  })

  it('fixture：L3 runtime 存在 / 唔存在', () => {
    const root = makeTmp()
    mkdirSync(path.join(root, 'briefing'), { recursive: true })
    writeFileSync(path.join(root, 'briefing', 'fetch.ts'), 'export const x = 1\n')
    expect(checkRuntimePath(root, 'briefing/fetch.ts', root)).toMatchObject({ ok: true })
    expect(checkRuntimePath(root, 'briefing/missing.ts', root).ok).toBe(false)
  })

  it('fixture：L4 runtime 解析到注入嘅 profilesRoot 並搵到 / 搵唔到檔案', () => {
    const root = makeTmp()
    const profiles = path.join(root, 'profiles')
    mkdirSync(path.join(profiles, 'personal-assistant', 'skills', 'daily-briefing'), { recursive: true })
    writeFileSync(path.join(profiles, 'personal-assistant', 'skills', 'daily-briefing', 'SKILL.md'), '# x\n')

    const ok = checkRuntimePath(root, 'skills/daily-briefing/SKILL.md', profiles)
    expect(ok.ok).toBe(true)
    expect(ok.resolved).toBe(
      path.join(profiles, 'personal-assistant', 'skills/daily-briefing/SKILL.md'),
    )

    const missing = checkRuntimePath(root, 'SOUL.md', profiles)
    expect(missing.ok).toBe(false)
    expect(missing.resolved).toBe(path.join(profiles, 'personal-assistant', 'SOUL.md'))
  })
})

describe('isValidCronExpr（5 欄位）', () => {
  it('合法：jobs.json 現實用緊嘅形態', () => {
    expect(isValidCronExpr('0 7 * * *')).toBe(true)
    expect(isValidCronExpr('0 7-19 * * 1-5')).toBe(true)
    expect(isValidCronExpr('0 9,17 * * 6,0')).toBe(true)
    expect(isValidCronExpr('*/15 * * * *')).toBe(true)
    expect(isValidCronExpr('30 23 * * *')).toBe(true)
  })

  it('欄位數錯', () => {
    expect(isValidCronExpr('0 7 * *')).toBe(false)
    expect(isValidCronExpr('* * * * * *')).toBe(false)
    expect(isValidCronExpr('')).toBe(false)
  })

  it('數值超界', () => {
    expect(isValidCronExpr('60 * * * *')).toBe(false) // 分 > 59
    expect(isValidCronExpr('* 24 * * *')).toBe(false) // 時 > 23
    expect(isValidCronExpr('* * 0 * *')).toBe(false) // 日由 1 起
    expect(isValidCronExpr('* * * 13 *')).toBe(false) // 月 > 12
    expect(isValidCronExpr('* * * * 8')).toBe(false) // 週 > 7
    expect(isValidCronExpr('0 25-30 * * *')).toBe(false) // 範圍超界
  })

  it('格式錯', () => {
    expect(isValidCronExpr('a b * * *')).toBe(false)
    expect(isValidCronExpr('*/0 * * * *')).toBe(false) // step 0
    expect(isValidCronExpr('0 7 * * Mon')).toBe(false) // 唔支援名稱
  })
})

describe('findSkillDir（fixture 模擬嵌套 skill 目錄）', () => {
  function makeSkillsRoot(): string {
    const root = makeTmp()
    const skills = path.join(root, 'skills')
    mkdirSync(path.join(skills, 'daily-briefing'), { recursive: true })
    mkdirSync(path.join(skills, 'note-taking', 'obsidian'), { recursive: true })
    mkdirSync(path.join(skills, '.archive', 'obsidian'), { recursive: true }) // 唔應該被當存在
    return skills
  }

  it('頂層 skill 搵到', () => {
    expect(findSkillDir(makeSkillsRoot(), 'daily-briefing')).not.toBeNull()
  })

  it('嵌套 skill 搾到，而且唔會撞 .archive/ 入面嘅同名目錄', () => {
    const got = findSkillDir(makeSkillsRoot(), 'obsidian')
    expect(got).not.toBeNull()
    expect(got!).toContain(path.join('note-taking', 'obsidian'))
    expect(got!).not.toContain('.archive')
  })

  it('唔存在嘅 skill → null', () => {
    expect(findSkillDir(makeSkillsRoot(), 'ghost-skill')).toBeNull()
  })
})

describe('validateJobs', () => {
  const exists = (name: string) => name === 'daily-briefing' || name === 'obsidian'

  it('全部正常 → 零 issues', () => {
    const raw = {
      jobs: [
        { id: 'a1', name: 'A', skills: ['daily-briefing'], schedule: { kind: 'cron', expr: '0 7 * * *' } },
        { id: 'b2', name: 'B', skills: [], schedule: { kind: 'cron', expr: '0 9,17 * * 6,0' } },
      ],
    }
    const { jobCount, issues } = validateJobs(raw, exists)
    expect(jobCount).toBe(2)
    expect(issues).toEqual([])
  })

  it('skills 引用唔存在嘅 skill → issue 帶 job id + name + skill 名', () => {
    const raw = {
      jobs: [{ id: 'c3', name: 'C', skills: ['ghost-skill'], schedule: { kind: 'cron', expr: '0 7 * * *' } }],
    }
    const { issues } = validateJobs(raw, exists)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.jobId).toBe('c3')
    expect(issues[0]!.jobName).toBe('C')
    expect(issues[0]!.message).toBe('skills 引用唔存在的 skill: ghost-skill')
  })

  it('schedule.expr 欄位數錯 → issue「不是合法 cron 表達式」帶實際值', () => {
    const raw = {
      jobs: [{ id: 'd4', name: 'D', skills: [], schedule: { kind: 'cron', expr: '0 7 * *' } }],
    }
    const { issues } = validateJobs(raw, exists)
    expect(issues[0]!.message).toContain('不是合法 cron 表達式')
    expect(issues[0]!.message).toContain('0 7 * *')
  })

  it('同一個 job 可以同時有 skills + schedule 兩種 issue', () => {
    const raw = {
      jobs: [{ id: 'e5', name: 'E', skills: ['ghost-skill'], schedule: { kind: 'cron', expr: 'nope' } }],
    }
    const { issues } = validateJobs(raw, exists)
    expect(issues).toHaveLength(2)
  })

  it('jobs.json 冇 jobs 陣列 → DocCheckError', () => {
    expect(() => validateJobs({ nope: true }, exists)).toThrow(DocCheckError)
    expect(() => validateJobs(null, exists)).toThrow(DocCheckError)
  })
})

describe('stableStringify / hashValue（n8n hash 用）', () => {
  it('key 順序唔同 → 同一個 hash（遞迴排序，對齊 Python sort_keys=True）', () => {
    expect(stableStringify({ a: 1, b: { y: 2, x: 1 } })).toBe('{"a":1,"b":{"x":1,"y":2}}')
    expect(hashValue({ a: 1, b: { y: 2, x: 1 } })).toBe(hashValue({ b: { x: 1, y: 2 }, a: 1 }))
  })

  it('內容唔同 → 唔同 hash', () => {
    expect(hashValue({ nodes: [1, 2] })).not.toBe(hashValue({ nodes: [1, 3] }))
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 1, b: null }))
  })

  it('JSON 字串形式同物件形式 hash 一致（sqlite TEXT 欄情境）', () => {
    const obj = { nodes: [{ p: 1 }], connections: { main: [[{}]] } }
    expect(hashValue(JSON.parse(JSON.stringify(obj)))).toBe(hashValue(obj))
  })
})
