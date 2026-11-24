## Why

骨架（Vite + TypeScript + Supabase）已經搭好但未有功能，唔知 GitHub repo + Supabase 呢個組合實際行唔行得通。用最小嘅真實功能驗證整條鏈：前端 → Supabase Postgres（含 RLS）→ GitHub Pages 靜態部署。

## What Changes

- 新增 `messages` table（`id`, `name`, `message`, `created_at`），只經 migration 建立
- 新增 RLS policy：任何人可 `SELECT` 同 `INSERT`，冇 `UPDATE` / `DELETE`
- 前端加留言表單（暱稱 + 內容）同「最新 3 條留言」列表
- 提交成功後重新載入列表；失敗時顯示錯誤且保留輸入內容
- Vite build 設定 `base` 配合 GitHub Pages subpath，加 GitHub Actions 自動部署
- Repo 由 private 轉 public（GitHub Pages free plan 需要）

## Capabilities

### New Capabilities

- `guestbook`: 訪客留言嘅提交、儲存、以及顯示最近 3 條留言

### Modified Capabilities

<!-- 無現有 capability 被修改 -->

## Impact

- **DB**：新 migration（`messages` table + RLS policies），需要 `supabase db push` 落 cloud
- **Code**：`src/lib/`（留言查詢／驗證純邏輯）、`src/main.ts`（DOM 接線）、`index.html`（表單 + 列表）、`vite.config.ts`（base path）
- **CI/CD**：`.github/workflows/deploy.yml`（GitHub Pages）
- **外部**：GitHub repo visibility private → public
- **依賴**：無新增（`@supabase/supabase-js` 已存在）
