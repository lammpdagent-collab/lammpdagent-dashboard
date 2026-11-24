/**
 * 留言查詢封裝 —— 收注入嘅最小 client 介面，測試可以用假物件。
 * Supabase 回傳嘅 `error` 有值就包成 Error（cause 帶原件）向上拋。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseRow, type MessageEntry } from './guestbook'

/** repository 需要嘅最小 client 介面（只需 `from`）。 */
export interface MessageClient {
  from: SupabaseClient['from']
}

/** 讀取最近 `limit` 條留言，由新至舊。 */
export async function fetchLatest(client: MessageClient, limit = 3): Promise<MessageEntry[]> {
  const { data, error } = await client
    .from('messages')
    .select('id,name,message,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    throw new Error('載入留言失敗，請稍後再試', { cause: error })
  }
  return (data ?? []).map(normaliseRow).filter((entry): entry is MessageEntry => entry !== null)
}

/** 新增一條留言。成功後由呼叫方用 fetchLatest 重載列表（唔 .select() 返行）。 */
export async function insertMessage(
  client: MessageClient,
  input: { name: string; message: string },
): Promise<void> {
  const { error } = await client
    .from('messages')
    .insert({ name: input.name, message: input.message })
  if (error) {
    throw new Error('提交留言失敗', { cause: error })
  }
}
