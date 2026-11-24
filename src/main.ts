/**
 * DOM 接線層 —— 只做接線，邏輯喺 src/lib/。
 */
import { getSupabase } from './lib/supabase'
import { fetchLatest, insertMessage, type MessageClient } from './lib/repository'
import { formatTimestamp, validateMessage, type MessageEntry } from './lib/guestbook'

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const formEl = document.querySelector<HTMLFormElement>('#guestbook-form')!
const nameEl = document.querySelector<HTMLInputElement>('#name')!
const messageEl = document.querySelector<HTMLTextAreaElement>('#message')!
const submitBtn = document.querySelector<HTMLButtonElement>('#submit-btn')!
const nameErrorEl = document.querySelector<HTMLParagraphElement>('#name-error')!
const messageErrorEl = document.querySelector<HTMLParagraphElement>('#message-error')!
const formErrorEl = document.querySelector<HTMLParagraphElement>('#form-error')!
const listEl = document.querySelector<HTMLOListElement>('#guestbook-list')!
const emptyEl = document.querySelector<HTMLParagraphElement>('#guestbook-empty')!

let client: MessageClient | undefined
let submitting = false

/** 渲染一條留言 —— 只用 createElement + textContent（留言係訪客輸入，唔用 innerHTML）。 */
function renderEntry(entry: MessageEntry): void {
  const li = document.createElement('li')
  const name = document.createElement('span')
  name.textContent = entry.name
  const content = document.createElement('p')
  content.textContent = entry.message
  const time = document.createElement('time')
  time.textContent = formatTimestamp(entry.createdAt)
  li.append(name, content, time)
  listEl.append(li)
}

/** 載入最近 3 條留言；空陣列顯示空狀態。回傳是否成功，俾呼叫方區分 reload 失敗。 */
async function loadList(): Promise<boolean> {
  statusEl.textContent = '載入中…'
  try {
    const entries = await fetchLatest(client!, 3)
    listEl.replaceChildren()
    for (const entry of entries) {
      renderEntry(entry)
    }
    emptyEl.hidden = entries.length !== 0
    statusEl.textContent = `已載入 ${entries.length} 條留言`
    return true
  } catch (err) {
    // DB／網絡錯誤：固定字串上 UI，原件入 console。
    // 保留畫面上已有嘅留言（唔清空、唔改 empty 狀態），只更新狀態文字——
    // reload 失敗唔應該令用戶失去之前見到嘅列表。
    console.error(err)
    statusEl.textContent = '載入留言失敗，請稍後再試'
    return false
  }
}

/** 提交留言：驗證 → submitting guard → insert → 重載列表。 */
async function handleSubmit(event: Event): Promise<void> {
  event.preventDefault()
  formErrorEl.textContent = ''

  const result = validateMessage(nameEl.value, messageEl.value)
  if (!result.ok) {
    // 逐欄位錯誤：唔發請求、唔清 input
    nameErrorEl.textContent = result.errors.name ?? ''
    messageErrorEl.textContent = result.errors.message ?? ''
    return
  }
  nameErrorEl.textContent = ''
  messageErrorEl.textContent = ''

  // module-level guard：提交期間再觸發（例如 Enter 鍵）都唔會重複送出
  if (submitting) return
  submitting = true
  submitBtn.disabled = true
  try {
    await insertMessage(client!, { name: result.name, message: result.message })
    // 提交確實成功：照清空輸入
    nameEl.value = ''
    messageEl.value = ''
    const reloaded = await loadList()
    if (!reloaded) {
      // reload 失敗唔係提交失敗：分開講，避免用戶以為要重打而重複送出
      formErrorEl.textContent = '已提交，但列表載入失敗，請重新整理頁面'
    }
  } catch (err) {
    // DB／網絡錯誤：固定字串上 UI，原件入 console；保留輸入
    console.error(err)
    formErrorEl.textContent = '提交失敗，請再試'
  } finally {
    submitting = false
    submitBtn.disabled = false
  }
}

async function init(): Promise<void> {
  try {
    client = getSupabase()
  } catch (err) {
    console.error(err)
    statusEl.textContent = '✗ 缺少 Supabase 環境變數（檢查 .env）'
    nameEl.disabled = true
    messageEl.disabled = true
    submitBtn.disabled = true
    return
  }
  formEl.addEventListener('submit', handleSubmit)
  await loadList()
}

void init()
