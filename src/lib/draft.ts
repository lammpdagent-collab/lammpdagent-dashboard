/**
 * 草稿 dirty 判斷（M2 / N9）——由 main.ts captureFocus 抽出嘅純判斷，
 * 補單元測試（N9）。唔碰 DOM、唔碰 store。
 */

/**
 * render 前捕捉焦點欄位時，決定未 commit 草稿值使唔使保留：
 * 只有「真係 dirty」（用戶手打過、而且 store state 自上次 capture 以嚟冇變）
 * 先算草稿。restore 唔會將 rollback 後嘅失敗值寫返上 DOM，亦唔會蓋走
 * 另一部裝置嘅新值。
 *
 * @param fieldValue 焦點元素當下嘅值（用戶見到／打緊嘅）
 * @param stateValue store 入面該欄位嘅現值
 * @param baseline 上次 capture 時見到嘅 state 欄位值（冇記錄時呼叫方傳 stateValue）
 * @returns true = dirty（保留草稿）；false = 唔 dirty（restore 唔覆蓋 state 值）
 */
export function isDraftDirty(fieldValue: string, stateValue: string, baseline: string): boolean {
  return fieldValue !== stateValue && stateValue === baseline
}
