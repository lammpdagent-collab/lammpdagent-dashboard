/**
 * 環境變數讀取 —— 純函數，唔直接碰 import.meta.env，方便 unit test。
 */

/** 讀必要環境變數；缺失或空白就拋錯，唔好靜靜當 undefined。 */
export function readEnv(
  source: Record<string, string | undefined>,
  key: string,
): string {
  const value = source[key]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少環境變數 ${key}（請對照 .env.example）`)
  }
  return value
}

/** 只檢查存在性，唔拋錯；用嚟做啟動時嘅狀態顯示。 */
export function hasEnv(
  source: Record<string, string | undefined>,
  key: string,
): boolean {
  const value = source[key]
  return value !== undefined && value.trim() !== ''
}
