import { hasEnv } from './lib/env'

const el = document.querySelector<HTMLParagraphElement>('#status')!

// 只有 VITE_ 前綴嘅變數會 expose 落 client bundle
const ready =
  hasEnv(import.meta.env as Record<string, string | undefined>, 'VITE_SUPABASE_URL') &&
  hasEnv(
    import.meta.env as Record<string, string | undefined>,
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  )

el.textContent = ready
  ? '✓ Supabase 環境變數已載入（骨架就緒，未有功能）'
  : '✗ 缺少 Supabase 環境變數（檢查 .env）'
