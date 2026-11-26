/**
 * 認證閘（R1-6 / D13）—— view 判定純函式（可 unit test）+ is_owner RPC 閘 +
 * Google OAuth signIn。owner email 只存 DB（policy 同 RPC 各一份），bundle 內零 email。
 * 本檔唔做任何任務／事件查詢；未過閘之前零資料查詢、零訂閱（main.ts 負責按 view 接線）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwner } from './api'
import type { AppView } from './types'

/** owner RPC 檢查結果：null = 未查（session 已有，等緊 RPC）；'error' = RPC 呼叫本身失敗。 */
export type OwnerCheck = boolean | 'error' | null

/**
 * view 狀態機（純函式）：
 * - 無 session → 'login'（未登入前唔理 ownerCheck —— 根本未查）
 * - session + ownerCheck null → 'loading'（查詢中）
 * - session + owner true → 'ready'
 * - session + owner false → 'blocked'（「無法存取」）
 * - session + ownerCheck 'error' → 'error'（檢查本身失敗，可重試）
 */
export function resolveView(hasSession: boolean, ownerCheck: OwnerCheck): AppView {
  if (!hasSession) return 'login'
  if (ownerCheck === null) return 'loading'
  if (ownerCheck === 'error') return 'error'
  return ownerCheck ? 'ready' : 'blocked'
}

function isPermissionDenied(error: unknown): boolean {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    if ((error as { code?: unknown }).code === '42501') return true // SQLSTATE permission denied
  }
  return error instanceof Error && /permission denied/i.test(error.message)
}

/**
 * owner RPC 檢查：
 * - RPC 回 boolean → 照傳
 * - permission denied（42501；session 異常時先會發生，§4.9）→ 當 not-owner → 'blocked'，
 *   行為安全：用戶會行「改用其他帳戶」登出重嚟，唔會撞重試死循環
 * - 其他錯（網絡等）→ 'error'（error view，可重試）
 */
export async function checkOwner(client: SupabaseClient): Promise<OwnerCheck> {
  try {
    return await isOwner(client)
  } catch (error) {
    if (isPermissionDenied(error)) return false
    return 'error'
  }
}

/**
 * 讀 cached session → 無 session 'login'；有 session 就行 is_owner RPC 閘。
 * 注意 getSession 讀 localStorage 快取，JWT 可能已過期——過期 session 查詢會 401，
 * 行「請重新登入」路徑（§4.9）。
 */
export async function resolveCurrentView(client: SupabaseClient): Promise<AppView> {
  const { data, error } = await client.auth.getSession()
  if (error !== null || data.session === null) return 'login'
  return resolveView(true, await checkOwner(client))
}

/**
 * Google OAuth 登入。redirectTo = origin + BASE_URL（GitHub Pages 子路徑都要啱，
 * 對應 Step 0 嘅 Redirect URLs 白名單）；prompt=select_account 令「改用其他帳戶」
 * 真係彈返 Google 帳戶選擇器，唔會自動續用同一帳號（防 blocked 死循環）。
 */
export async function signIn(client: SupabaseClient): Promise<void> {
  await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${location.origin}${import.meta.env.BASE_URL}`,
      queryParams: { prompt: 'select_account' },
    },
  })
}
