/**
 * Supabase client —— lazy singleton。第一次 call 先建立，
 * 等呼叫方（main.ts）可以 catch 缺 env 嘅情況顯示訊息，唔會 import 即白屏。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readEnv } from './env'

let client: SupabaseClient | undefined

/** 取得 Supabase client；缺 env 時拋錯（readEnv 嘅訊息）。 */
export function getSupabase(): SupabaseClient {
  if (client === undefined) {
    const env = import.meta.env as Record<string, string | undefined>
    client = createClient(
      readEnv(env, 'VITE_SUPABASE_URL'),
      readEnv(env, 'VITE_SUPABASE_PUBLISHABLE_KEY'),
    )
  }
  return client
}
