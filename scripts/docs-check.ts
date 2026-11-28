// scripts/docs-check.ts — 文件漂移檢查（docs drift check）
//
// 契約：tests/docs-check.test.ts（30 個測試釘住行為）+ SYSTEM.md §4 格式契約
// 註：原 openspec change 已按 Dickson 決定刪除 —— openspec 只收產品功能，
//     開發工具的行為契約由 tests 管（tests 會跑，spec 只會被讀）。
// 原則：SYSTEM.md §4 是唯一資料源，本 script 只驗證它，唔另寫路徑清單。
// 跑法：npm run docs:check（= node --experimental-transform-types scripts/docs-check.ts）
//       npm run docs:check -- --no-l4（CI：跳過所有 L4 / Hermes profile 檢查）
// 依賴：零新 npm 依賴 —— 只用 node 內建 fs / path / os / url / crypto / node:sqlite。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// 錯誤類型：格式契約錯誤（防靜默跳過）—— 一律明確報錯 + exit 1
// ---------------------------------------------------------------------------

export class DocCheckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocCheckError'
  }
}

// ---------------------------------------------------------------------------
// §4 表格解析
// ---------------------------------------------------------------------------

export interface Section4Row {
  /** SYSTEM.md 內的實際行號（1-based） */
  lineNo: number
  /** 原始行（已 trim） */
  raw: string
  /** 左欄（Spec）的 backtick token */
  specTokens: string[]
  /** 中欄（Runtime 實作）的 backtick token */
  runtimeTokens: string[]
  /** 右欄（其他受影響）原文 —— 資訊性，唔做存在性檢查 */
  otherCell: string
}

export interface Section4 {
  rows: Section4Row[]
}

/** 抽出一個表格 cell 內所有 backtick 包住的 token */
export function extractBacktickTokens(cell: string): string[] {
  const out: string[] = []
  const re = /`([^`]+)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cell)) !== null) {
    out.push(m[1].trim())
  }
  return out
}

/** 一行 markdown 表格 → cell 陣列（去頭尾 pipe、逐 cell trim） */
function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

/**
 * 解析 SYSTEM.md 內容，抽 `## 4.` 章節內第一個 markdown 表格。
 * 格式唔符預期 → 擲 DocCheckError（防靜默跳過），由 CLI 轉成 exit 1。
 */
export function parseSection4(content: string): Section4 {
  const lines = content.split(/\r?\n/)

  // 1. 搵 `## 4.` 開頭的章節
  const startIdx = lines.findIndex((l) => /^##\s+4\./.test(l.trim()))
  if (startIdx === -1) {
    throw new DocCheckError('SYSTEM.md §4 格式唔符預期：搵唔到 `## 4.` 開頭嘅章節，無法檢查')
  }

  // 2. 章節範圍：去到下一個 `## ` 級標題或檔案結尾
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      endIdx = i
      break
    }
  }

  // 3. 章節內第一個 markdown 表格（連續以 `|` 開頭的行）
  let tableStart = -1
  for (let i = startIdx; i < endIdx; i++) {
    if (lines[i].trim().startsWith('|')) {
      tableStart = i
      break
    }
  }
  if (tableStart === -1) {
    throw new DocCheckError('SYSTEM.md §4 格式唔符預期：章節內搵唔到任何 markdown 表格，無法檢查')
  }
  let tableEnd = tableStart
  while (tableEnd < endIdx && lines[tableEnd].trim().startsWith('|')) tableEnd++
  const tableLines = lines.slice(tableStart, tableEnd)

  if (tableLines.length < 3) {
    throw new DocCheckError(
      `SYSTEM.md §4 格式唔符預期：表格只有 ${tableLines.length} 行（要 header + 分隔行 + 至少一行資料），無法檢查`,
    )
  }

  const headerCells = splitTableRow(tableLines[0])
  if (headerCells.length !== 3) {
    throw new DocCheckError(
      `SYSTEM.md §4 格式唔符預期：header 行要 3 欄，實際 ${headerCells.length} 欄：${tableLines[0].trim()}`,
    )
  }
  const sep = tableLines[1].trim()
  if (!/^\|[\s:|-]+\|$/.test(sep)) {
    throw new DocCheckError(`SYSTEM.md §4 格式唔符預期：表格第二行唔係 |---| 分隔行：${sep}`)
  }

  // 4. 資料行：要 3 欄，唔可以靜默跳過
  const rows: Section4Row[] = []
  for (let i = 2; i < tableLines.length; i++) {
    const lineNo = tableStart + i + 1 // 1-based
    const raw = lines[tableStart + i]
    const cells = splitTableRow(tableLines[i])
    if (cells.length !== 3) {
      throw new DocCheckError(
        `SYSTEM.md §4 第 ${lineNo} 行欄位數唔符預期：要 3 欄，實際 ${cells.length} 欄。行內容：${raw.trim()}`,
      )
    }
    rows.push({
      lineNo,
      raw: raw.trim(),
      specTokens: extractBacktickTokens(cells[0]),
      runtimeTokens: extractBacktickTokens(cells[1]),
      otherCell: cells[2],
    })
  }
  return { rows }
}

// ---------------------------------------------------------------------------
// L3（repo 內）vs L4（Hermes profile）分類同路徑解析
// ---------------------------------------------------------------------------

/** token 以呢啲開頭 → L4（Hermes profile 內）；其他 → L3（repo 相對） */
const L4_PREFIXES = ['skills/', 'SOUL.md', 'cron/', 'config.yaml', 'scripts/'] as const

export function classifyPath(token: string): 'L3' | 'L4' {
  return L4_PREFIXES.some((p) => token.startsWith(p)) ? 'L4' : 'L3'
}

/**
 * token 係咪一條可以檢查存在性的路徑。
 * §4 內有啲 backtick token 唔係路徑（例如 `manual（query mode）`、cron id `43e12b7b639e`、
 * 欄位名 `sync`）—— 呢啲略過並喺輸出列明，唔靜默。
 */
export function isPathLikeToken(token: string): boolean {
  if (L4_PREFIXES.some((p) => token.startsWith(p))) return true
  if (token.includes('/')) return true
  if (/^[A-Za-z0-9._-]+\.(md|ts|tsx|js|mjs|cjs|json|yaml|yml|py|sql|toml|html|css)$/.test(token)) {
    return true
  }
  return false
}

/** L3 spec 路徑：`specs/<cap>/spec.md` → `<repo>/openspec/specs/<cap>/spec.md` */
export function resolveSpecPath(repoRoot: string, token: string): string {
  if (token.startsWith('openspec/')) return path.join(repoRoot, token)
  return path.join(repoRoot, 'openspec', token)
}

/** L4 預設 profiles 根目錄（Windows：%LOCALAPPDATA%\hermes\profiles；POSIX：~/.local/share/hermes/profiles） */
export function getDefaultProfilesRoot(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) return path.join(localAppData, 'hermes', 'profiles')
    return path.join(homedir(), 'AppData', 'Local', 'hermes', 'profiles')
  }
  return path.join(homedir(), '.local', 'share', 'hermes', 'profiles')
}

/**
 * L4 路徑解析：`<token>` → `<profilesRoot>/<profile>/<token>`。
 * `skills/note-taking/school-calendar-sync` 這種已含子目錄嘅 token 直接接上去。
 */
export function resolveL4Path(token: string, profilesRoot?: string, profileName = 'personal-assistant'): string {
  const root = profilesRoot ?? getDefaultProfilesRoot()
  return path.join(root, profileName, token)
}

export interface PathCheckResult {
  ok: boolean
  resolved: string
}

/** spec 存在性：token → openspec 內路徑 → 存在？ */
export function checkSpecPath(repoRoot: string, token: string): PathCheckResult {
  const resolved = resolveSpecPath(repoRoot, token)
  return { ok: existsSync(resolved), resolved }
}

/** runtime 存在性：先分類 L3/L4，再各自解析 → 存在？ */
export function checkRuntimePath(repoRoot: string, token: string, profilesRoot?: string): PathCheckResult {
  if (classifyPath(token) === 'L4') {
    const resolved = resolveL4Path(token, profilesRoot)
    return { ok: existsSync(resolved), resolved }
  }
  const resolved = path.join(repoRoot, token)
  return { ok: existsSync(resolved), resolved }
}

// ---------------------------------------------------------------------------
// cron/jobs.json 檢查
// ---------------------------------------------------------------------------

export interface JobIssue {
  jobId: string
  jobName: string
  message: string
}

/** 5 欄位 cron 表達式：分 時 日 月 週，數字/範圍/清單/step，唔支援名稱（Jan、Mon） */
export function isValidCronExpr(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const bounds: Array<[number, number]> = [
    [0, 59], // 分
    [0, 23], // 時
    [1, 31], // 日
    [1, 12], // 月
    [0, 7], // 週（0 同 7 都係星期日）
  ]
  return fields.every((f, i) => isCronField(f, bounds[i]![0], bounds[i]![1]))
}

function isCronField(field: string, min: number, max: number): boolean {
  return field.split(',').every((part) => {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part)
    if (!m) return false
    if (m[1] !== '*') {
      const v = Number(m[1])
      if (v < min || v > max) return false
      if (m[2] !== undefined) {
        const hi = Number(m[2])
        if (hi < v || hi > max) return false
      }
    }
    if (m[3] !== undefined && Number(m[3]) === 0) return false // step 0 唔合法
    return true
  })
}

/**
 * 遞迴喺 skills/ 底下搵名為 <name> 嘅 skill 目錄。
 * skill 可以嵌套（skills/note-taking/obsidian）；`.archive/` 等 dot 目錄唔算存在。
 */
export function findSkillDir(skillsRoot: string, name: string, maxDepth = 3): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: skillsRoot, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    let entries: Array<{ isDirectory(): boolean; name: string }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.')) continue
      if (e.name === name) return path.join(dir, e.name)
      if (depth + 1 < maxDepth) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
    }
  }
  return null
}

/**
 * 驗證 jobs.json：
 * - `skills` 陣列內每個名稱對應一個存在的 skill 目錄（skillDirExists 注入，方便測試）
 * - `schedule.kind === 'cron'` 時 `schedule.expr` 要係合法 5 欄位 cron 表達式
 * 格式唔符（冇 jobs 陣列）→ 擲 DocCheckError。
 */
export function validateJobs(
  raw: unknown,
  skillDirExists: (name: string) => boolean,
): { jobCount: number; issues: JobIssue[] } {
  const jobs = (raw as { jobs?: unknown } | null | undefined)?.jobs
  if (!Array.isArray(jobs)) {
    throw new DocCheckError('cron/jobs.json 格式唔符預期：搵唔到 jobs 陣列')
  }
  const issues: JobIssue[] = []
  for (const job of jobs) {
    const j = job as Record<string, unknown>
    const id = typeof j.id === 'string' ? j.id : '（無 id）'
    const name = typeof j.name === 'string' ? j.name : '（無 name）'

    const skills = j.skills
    if (skills !== undefined && skills !== null && !Array.isArray(skills)) {
      issues.push({ jobId: id, jobName: name, message: 'skills 唔係陣列' })
    } else if (Array.isArray(skills)) {
      for (const s of skills) {
        if (typeof s !== 'string') {
          issues.push({ jobId: id, jobName: name, message: `skills 內有非字串項目：${String(s)}` })
          continue
        }
        if (!skillDirExists(s)) {
          issues.push({ jobId: id, jobName: name, message: `skills 引用唔存在的 skill: ${s}` })
        }
      }
    }

    const schedule = j.schedule as { kind?: unknown; expr?: unknown } | undefined
    if (schedule === undefined || schedule === null || typeof schedule !== 'object') {
      issues.push({ jobId: id, jobName: name, message: 'schedule 唔存在' })
    } else if (schedule.kind === 'cron') {
      const expr = schedule.expr
      if (typeof expr !== 'string' || !isValidCronExpr(expr)) {
        issues.push({
          jobId: id,
          jobName: name,
          message: `schedule.expr "${String(expr)}" 不是合法 cron 表達式（要 5 欄位）`,
        })
      }
    }
  }
  return { jobCount: jobs.length, issues }
}

// ---------------------------------------------------------------------------
// n8n hash（穩定 stringify：遞迴排序 key，對齊 Python json.dumps(sort_keys=True)）
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'undefined') return String(value)
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/** sha256 嘅頭 16 個 hex 字元（同 SYSTEM.md §7 檢查清單的 Python 版一致） */
export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)
}

/** sqlite 的 TEXT 欄可能係 JSON 字串 —— 轉返物件先 hash */
function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface N8nCheckResult {
  lines: string[]
  failures: number
}

/**
 * n8n 快照一致性：live（~/.n8n/database.sqlite workflow_entity）vs n8n/workflows/*.json。
 * sqlite 唔存在 / 讀取失敗 → 跳過，唔當失敗。
 */
async function checkN8n(repoRoot: string): Promise<N8nCheckResult> {
  const dbPath = path.join(homedir(), '.n8n', 'database.sqlite')
  if (!existsSync(dbPath)) {
    return { lines: [`  --  跳過（環境沒有 n8n）：搵唔到 ${dbPath}`], failures: 0 }
  }

  let rows: Array<{ name: unknown; nodes: unknown; connections: unknown }>
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath)
    try {
      rows = db.prepare('SELECT name, nodes, connections FROM workflow_entity').all() as Array<{
        name: unknown
        nodes: unknown
        connections: unknown
      }>
    } finally {
      db.close()
    }
  } catch (err) {
    return { lines: [`  --  跳過（環境沒有 n8n）：sqlite 讀取失敗 —— ${msg(err)}`], failures: 0 }
  }

  const wfDir = path.join(repoRoot, 'n8n', 'workflows')
  let snapFiles: string[]
  try {
    snapFiles = readdirSync(wfDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    return { lines: ['  FAIL n8n/workflows/', '       期望: 快照目錄存在', '       實際: 目錄不存在'], failures: 1 }
  }
  if (snapFiles.length === 0) {
    return { lines: ['  FAIL n8n/workflows/', '       期望: 至少一個 *.json 快照', '       實際: 0 個快照'], failures: 1 }
  }

  const lines: string[] = []
  let failures = 0
  for (const file of snapFiles) {
    const snapPath = path.join(wfDir, file)
    let snap: Record<string, unknown>
    try {
      snap = JSON.parse(readFileSync(snapPath, 'utf8')) as Record<string, unknown>
    } catch (err) {
      failures++
      lines.push(`  FAIL ${file}`, `       實際: JSON parse 失敗 —— ${msg(err)}`)
      continue
    }
    const snapName = typeof snap.name === 'string' ? snap.name : null
    const byName = snapName === null ? [] : rows.filter((r) => r.name === snapName)
    const live =
      byName.length === 1 ? byName[0] : byName.length === 0 && rows.length === 1 ? rows[0] : null
    if (!live) {
      failures++
      lines.push(
        `  FAIL ${file}`,
        `       實際: 搵唔到對應嘅 live workflow（快照 name=${String(snapName)}，live workflow 有 ${rows.length} 個）`,
      )
      continue
    }
    const pairs: Array<{ label: string; liveV: unknown; snapV: unknown }> = [
      { label: 'nodes', liveV: parseMaybeJson(live.nodes), snapV: snap.nodes },
      { label: 'connections', liveV: parseMaybeJson(live.connections), snapV: snap.connections },
    ]
    const drifted = pairs.filter((p) => hashValue(p.liveV) !== hashValue(p.snapV))
    if (drifted.length === 0) {
      const detail = pairs
        .map((p) => `${p.label} live=${hashValue(p.liveV)} snap=${hashValue(p.snapV)}`)
        .join('；')
      lines.push(`  OK  ${file}：${detail}`)
    } else {
      failures++
      lines.push(`  FAIL ${file}（快照 name=${String(snapName)}）`)
      for (const p of pairs) {
        const liveH = hashValue(p.liveV)
        const snapH = hashValue(p.snapV)
        const verdict = liveH === snapH ? 'OK' : 'DRIFT'
        lines.push(`       ${p.label.padEnd(11)} live=${liveH} / snapshot=${snapH} → ${verdict}`)
      }
    }
  }
  return { lines, failures }
}

// ---------------------------------------------------------------------------
// CLI 主流程
// ---------------------------------------------------------------------------

function printFailure(token: string, result: PathCheckResult, row: Section4Row, level: 'L3' | 'L4'): void {
  console.log(`  FAIL ${token}${level === 'L4' ? '（L4）' : ''}`)
  console.log(`       期望: ${result.resolved}`)
  console.log(`       實際: 檔案不存在`)
  console.log(`       §4 行 ${row.lineNo}: ${row.raw}`)
}

async function main(): Promise<void> {
  const noL4 = process.argv.slice(2).includes('--no-l4')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const profilesRoot = getDefaultProfilesRoot()

  console.log('=== docs:check ===')
  if (noL4) console.log('（--no-l4：跳過所有 L4 / Hermes profile 檢查）')
  console.log('')

  let failures = 0

  // [1/5] §4 解析 —— 格式錯即刻中止（設計：唔需要跑其他）
  console.log('[1/5] SYSTEM.md §4 格式')
  let table: Section4
  try {
    const content = readFileSync(path.join(repoRoot, 'SYSTEM.md'), 'utf8')
    table = parseSection4(content)
    console.log(`  OK  表格存在，${table.rows.length} 行`)
  } catch (err) {
    if (err instanceof DocCheckError) {
      console.log(`  FAIL ${err.message}`)
      console.log('')
      console.log('=== 結果：SYSTEM.md §4 格式錯誤，中止檢查 ===')
      process.exitCode = 1
      return
    }
    throw err
  }

  // [2/5] spec 存在性
  console.log('[2/5] spec 檔案存在性')
  for (const row of table.rows) {
    for (const token of row.specTokens) {
      if (!isPathLikeToken(token)) continue
      const result = checkSpecPath(repoRoot, token)
      if (result.ok) {
        console.log(`  OK  ${token}`)
      } else {
        failures++
        printFailure(token, result, row, 'L3')
      }
    }
  }

  // [3/5] runtime 存在性（L3 repo 相對 / L4 profile 相對）
  console.log('[3/5] runtime 路徑存在性')
  const skippedTokens = new Set<string>()
  let l4Skipped = 0
  for (const row of table.rows) {
    for (const token of row.runtimeTokens) {
      if (!isPathLikeToken(token)) {
        skippedTokens.add(token)
        continue
      }
      const level = classifyPath(token)
      if (level === 'L4' && noL4) {
        l4Skipped++
        continue
      }
      const result = checkRuntimePath(repoRoot, token, profilesRoot)
      if (result.ok) {
        console.log(`  OK  ${token}${level === 'L4' ? '（L4）' : ''}`)
      } else {
        failures++
        printFailure(token, result, row, level)
      }
    }
  }
  if (l4Skipped > 0) console.log(`  --  跳過 ${l4Skipped} 個 L4 檢查（--no-l4）`)
  if (skippedTokens.size > 0) {
    console.log(`  --  略過非路徑 token（唔當失敗）：${[...skippedTokens].join('、')}`)
  }

  // [4/5] cron/jobs.json（位於 personal-assistant profile —— 屬 L4）
  console.log('[4/5] cron/jobs.json 一致性（L4）')
  if (noL4) {
    console.log('  --  跳過（--no-l4）')
  } else {
    const jobsPath = path.join(profilesRoot, 'personal-assistant', 'cron', 'jobs.json')
    if (!existsSync(jobsPath)) {
      failures++
      console.log('  FAIL cron/jobs.json')
      console.log(`       期望: ${jobsPath}`)
      console.log('       實際: 檔案不存在')
    } else {
      try {
        const raw: unknown = JSON.parse(readFileSync(jobsPath, 'utf8'))
        const skillsRoot = path.join(profilesRoot, 'personal-assistant', 'skills')
        const result = validateJobs(raw, (name) => findSkillDir(skillsRoot, name) !== null)
        if (result.issues.length === 0) {
          console.log(`  OK  ${result.jobCount} 個 job，skills 全部存在，schedule 全部合法`)
        } else {
          for (const issue of result.issues) {
            failures++
            console.log(`  FAIL ${issue.jobId}（${issue.jobName}）`)
            console.log(`       ${issue.message}`)
          }
        }
      } catch (err) {
        failures++
        console.log('  FAIL cron/jobs.json')
        if (err instanceof DocCheckError) {
          console.log(`       實際: ${err.message}`)
        } else {
          console.log(`       實際: JSON parse 失敗 —— ${msg(err)}`)
        }
        console.log(`       期望: ${jobsPath}`)
      }
    }
  }

  // [5/5] n8n 快照一致性（環境容許時；sqlite 唔存在 → 跳過，唔當失敗）
  console.log('[5/5] n8n 快照一致性（環境容許時）')
  const n8n = await checkN8n(repoRoot)
  for (const line of n8n.lines) console.log(line)
  failures += n8n.failures

  // 總結
  console.log('')
  if (failures > 0) {
    console.log(`=== 結果：${failures} 項失敗 ===`)
    process.exitCode = 1
  } else {
    console.log('=== 結果：全部通過 ===')
  }
}

// 只在直接執行時跑主流程（vitest import 呢個檔案唔會觸發）
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((err: unknown) => {
    console.error('docs:check 未預期錯誤：', err)
    process.exitCode = 1
  })
}
