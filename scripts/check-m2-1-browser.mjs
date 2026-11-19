// Real Chrome + real supabase-js with every Auth and /api response STUBBED: no email is sent and no
// cloud request leaves the browser. Proves UI, session persistence and local isolation, not real Auth.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const watchdog = setTimeout(() => { console.error('check-m2-1-browser timed out'); process.exit(1) }, 120_000)
const baseURL = process.env.CAREERTWIN_BASE_URL ?? 'http://127.0.0.1:5181'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage()
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const USERS = { 'a@careertwin1.test': '11111111-1111-4111-8111-111111111111', 'b@careertwin1.test': '22222222-2222-4222-8222-222222222222' }
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub, email) => `${part({ alg: 'HS256' })}.${part({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`
const emailOf = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).email
const calls = { otp: 0, verify: 0, logout: [] }
const errors = []
const unstubbed = []
const checks = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { const url = request.url(); if (!url.startsWith(baseURL) && !url.startsWith('data:') && !url.includes('/auth/v1/')) unstubbed.push(new URL(url).host) })

await page.route('**/auth/v1/**', async route => {
  const request = route.request()
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  const url = new URL(request.url())
  if (url.pathname.endsWith('/otp')) { calls.otp += 1; return route.fulfill({ status: 200, headers: cors, json: {} }) }
  if (url.pathname.endsWith('/verify')) {
    calls.verify += 1
    const body = request.postDataJSON()
    if (body.token === '000000') return route.fulfill({ status: 403, headers: cors, json: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } })
    const id = USERS[body.email]
    return route.fulfill({ status: 200, headers: cors, json: { access_token: jwt(id, body.email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: { id, aud: 'authenticated', email: body.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } } })
  }
  if (url.pathname.endsWith('/logout')) { calls.logout.push(url.searchParams.get('scope')); return route.fulfill({ status: 204, headers: cors }) }
  return route.fulfill({ status: 404, headers: cors, json: { msg: 'unexpected stub path' } })
})
await page.route('**/api/*', async route => {
  const token = route.request().headers().authorization.replace('Bearer ', '')
  const email = emailOf(token)
  const id = USERS[email]
  return route.fulfill({ status: 200, json: route.request().url().endsWith('/api/me') ? { user: { id, email } } : { ownerId: id, revision: 0, records: [] } })
})

const records = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('careertwin1-profile', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const db = request.result
    const get = db.transaction('records').objectStore('records').getAll()
    get.onsuccess = () => { db.close(); resolve(get.result) }
  }
}))
const account = () => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '账号' }).click()
const signIn = async (email, code = '123456') => {
  await page.getByRole('textbox', { name: '邮箱' }).fill(email)
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByText('发送成功不代表已登录', { exact: false }).waitFor()
  assert.equal(await page.getByText('当前账号').count(), 0)
  await page.getByRole('textbox', { name: '验证码' }).fill(code)
  await page.getByRole('button', { name: '验证并登录' }).click()
}
const connected = email => page.getByRole('status', { name: '云端连接状态' }).filter({ hasText: email }).waitFor()

try {
  await page.goto(baseURL); await page.getByText('未同步到云端', { exact: false }).waitFor()
  await page.getByRole('textbox', { name: /^项目原文/ }).fill('Local synthetic project')
  await page.getByRole('button', { name: /^Save as new/ }).click()
  await page.getByRole('button', { name: '跳过 / 取消补充' }).click()
  const before = await records()
  assert.equal(before.length, 1)

  await account()
  await page.getByText('登录、退出都不会上传', { exact: false }).waitFor()
  await signIn('a@careertwin1.test', '000000')
  await page.getByRole('alert').filter({ hasText: '已过期' }).waitFor()
  assert.equal(await page.getByText('当前账号').count(), 0)
  assert(await page.getByRole('button', { name: /重新发送/ }).isDisabled())
  checks.push('expired/invalid code shows an error, no login; resend is rate-limited in the UI')

  await page.getByRole('textbox', { name: '验证码' }).fill('123456')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await page.getByText('a@careertwin1.test', { exact: false }).first().waitFor()
  await connected('a@careertwin1.test')
  checks.push('code login shows the account and the API-verified identity')

  await page.reload()
  await connected('a@careertwin1.test')
  checks.push('session restored after reload')

  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByText('已退出云端账号', { exact: false }).waitFor()
  assert.deepEqual(calls.logout, ['local'])
  assert.equal(await page.getByText('a@careertwin1.test').count(), 0)
  await page.reload()
  await page.getByRole('button', { name: '发送验证码' }).waitFor()
  checks.push('local-scope sign-out clears the account and stays signed out after reload')

  await signIn('b@careertwin1.test')
  await connected('b@careertwin1.test')
  assert.equal(await page.getByText('a@careertwin1.test').count(), 0)
  checks.push('next account shows only its own identity')

  assert.deepEqual(await records(), before)
  checks.push('local IndexedDB records unchanged through login, sign-out and account change')

  await page.setViewportSize({ width: 375, height: 812 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  checks.push('375px account page has no horizontal overflow')

  assert.deepEqual(errors, []); assert.deepEqual(unstubbed, [])
  console.log(JSON.stringify({ result: 'passed', authStubbed: true, checks, calls, pageErrors: errors, unstubbedHosts: unstubbed }, null, 2))
} finally {
  clearTimeout(watchdog)
  await context.close(); await browser.close()
}
