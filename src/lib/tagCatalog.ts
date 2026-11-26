/**
 * Tag 目錄純邏輯 —— 任務 tag chips 排序、toggle、名稱驗證、批量移除。
 * 目錄（public.tags）係「可選項」權威；「已選」權威係 task.tags 本身
 * （design D2：就算目錄行已刪，任務已選 tag 仍照顯示）。
 */
import type { TagRow } from './types'

/** 展開區 tag chip：selected 來源係 task.tags，唔係目錄。 */
export interface TagChip {
  name: string
  selected: boolean
}

/** 驗證失敗 toast 文案（§4.11；DB CHECK 係後盾）。 */
export const TAG_NAME_ERROR = '標籤長度須為 1–40 字元'

/** 同次數 tie-break：zh-Hant 字母序。 */
function byNameZh(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hant')
}

/**
 * 展開區 tag chips 順序：已選置最前並標 selected；兩群內部都係
 * usage 降序、同次數 zh-Hant 字母序。usage 無記錄當 0。
 * 目錄無但任務已選嘅 tag 照出（selected）——目錄唔係「已選」權威（D2）。
 */
export function orderTagsForTask(
  taskTags: readonly string[],
  catalog: readonly TagRow[],
  usage: ReadonlyMap<string, number>,
): TagChip[] {
  const selected = new Set(taskTags)
  const names = new Set<string>()
  for (const row of catalog) names.add(row.name)
  for (const tag of taskTags) names.add(tag)
  const list = [...names]
  list.sort((a, b) => {
    const sel = (selected.has(a) ? 0 : 1) - (selected.has(b) ? 0 : 1)
    if (sel !== 0) return sel
    const byUsage = (usage.get(b) ?? 0) - (usage.get(a) ?? 0)
    if (byUsage !== 0) return byUsage
    return byNameZh(a, b)
  })
  return list.map((name) => ({ name, selected: selected.has(name) }))
}

/**
 * toggle：已選 → 移除；未選 → 加入。回全新陣列（純函式，唔 mutate task）。
 * 無 `×` 圖示、無自由輸入框（design D10）。
 */
export function toggleTagOnTask(task: { tags: string[] }, name: string): string[] {
  return task.tags.includes(name)
    ? task.tags.filter((tag) => tag !== name)
    : [...task.tags, name]
}

/**
 * 名稱驗證：trim 後長度 1–40 → 回 null（有效）；否則回錯誤訊息。
 * 前端先擋；DB CHECK（char_length(btrim(name)) between 1 and 40）係後盾。
 */
export function validateTagName(input: string): string | null {
  const name = input.trim()
  return name.length >= 1 && name.length <= 40 ? null : TAG_NAME_ERROR
}

/**
 * R1-4（`array_remove` 等價）：由多行任務移除同一個 tag，只回「有變」嘅
 * `{ id, tags }` —— 俾「移除使用中 tag」批量流程逐行 UPDATE 用（無 UPDATE
 * tags 欄以外嘅寫法，PostgREST 逐行 patch 等價 `array_remove`）。
 * 無關行唔會出現喺結果；行內同名 tag 全部移除。
 */
export function stripTag(
  rows: ReadonlyArray<{ id: string; tags: readonly string[] }>,
  name: string,
): Array<{ id: string; tags: string[] }> {
  const changed: Array<{ id: string; tags: string[] }> = []
  for (const row of rows) {
    if (!row.tags.includes(name)) continue
    changed.push({ id: row.id, tags: row.tags.filter((tag) => tag !== name) })
  }
  return changed
}

/**
 * m3：本地過濾「tags 含指定名稱」嘅行。tag 名可以含逗號／`}`／`"`——
 * PostgREST `cs.{a,b}` 陣列語法會誤拆或多個元素 / 報 400，所以 api 層
 * 撈全部行（id / tags / deleted_at）之後用呢個純函式喺 client 過濾
 * （任務表規模細、批量移除又係低頻管理動作，可接受）。
 */
export function rowsWithTag<T extends { tags: readonly string[] }>(
  rows: readonly T[],
  name: string,
): T[] {
  return rows.filter((row) => row.tags.includes(name))
}
