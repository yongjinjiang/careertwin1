// @vitest-environment jsdom
/** Account page behaviour with a fake AccountService (no real Auth): states, late responses, local isolation. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IDBFactory } from 'fake-indexeddb'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { AccountError, createDefaultAccountService, describeAuthError, readCloudClientConfig, type AccountService, type ApiResult } from '../../src/auth/service'
import { createProfileRepository } from '../../src/storage/repository'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  history.replaceState(null, '', '/#/account')
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

const session = (id: string, email: string) => ({ access_token: `token-${id}`, user: { id, email } }) as unknown as Session
interface Pending { path: string; token: string; resolve: (result: ApiResult<unknown>) => void }

function fakeService(initial: Session | null | Promise<Session | null> = null) {
  let listener: (session: Session | null) => void = () => {}
  const pending: Pending[] = []
  const service: AccountService = {
    getSession: () => Promise.resolve(initial),
    onSessionChange: next => { listener = next; return () => {} },
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => {}),
    signOut: vi.fn(async () => { listener(null) }),
    fetchApi: <T,>(path: '/api/me' | '/api/profile', token: string) => new Promise<ApiResult<T>>(resolve => { pending.push({ path, token, resolve: resolve as Pending['resolve'] }) }),
  }
  return { service, pending, emit: (next: Session | null) => act(async () => listener(next)) }
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('UI wait timed out: ' + container.textContent)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
}
function button(prefix: string) {
  const element = [...container.querySelectorAll('button')].find(item => item.textContent?.startsWith(prefix))
  if (!element) throw new Error('Button not found: ' + prefix)
  return element
}
async function fill(label: string, value: string) {
  const input = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const respond = (item: Pending, userId: string, email: string) => act(async () => item.resolve(item.path === '/api/me'
  ? { ok: true, data: { user: { id: userId, email } } }
  : { ok: true, data: { ownerId: userId, revision: 0, records: [{ id: `project:${userId}`, type: 'project' }] } }))

describe('M2.1 account page', () => {
  it('without cloud config shows a clear state and the local Profile still works', async () => {
    const repository = createProfileRepository(new IDBFactory())
    await act(async () => root.render(<App repository={repository} accountService={null} />))
    expect(container.textContent).toContain('云端账号尚未配置')
    expect(container.textContent).toContain('本地 Profile 仍可正常使用')
    await act(async () => { location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await until(() => Boolean(container.querySelector('textarea')))
  })

  it('sends a code without claiming login, verifies, and never touches the local repository', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const writes = ['createProject', 'updateProject', 'deleteProject', 'saveBasicInfo'].map(name => vi.spyOn(repository, name as 'createProject'))
    const { service } = fakeService(null)
    await act(async () => root.render(<App repository={repository} accountService={service} />))
    await until(() => container.textContent?.includes('发送验证码') ?? false)
    await fill('邮箱', 'a@careertwin1.test')
    await act(async () => button('发送验证码').click())
    await until(() => container.textContent?.includes('发送成功不代表已登录') ?? false)
    expect(container.textContent).not.toContain('登录成功')
    expect(button('重新发送').disabled).toBe(true)
    await fill('验证码', '12345')
    await act(async () => button('验证并登录').click())
    expect(container.textContent).toContain('6 位数字验证码')
    expect(service.verifyCode).not.toHaveBeenCalled()
    await fill('验证码', '123456')
    await act(async () => button('验证并登录').click())
    expect(service.verifyCode).toHaveBeenCalledWith('a@careertwin1.test', '123456')
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })

  it('shows verification errors as errors, never as success', async () => {
    const { service } = fakeService(null)
    service.verifyCode = vi.fn(async () => { throw new AccountError(describeAuthError({ code: 'otp_expired', status: 403, message: 'x' })) })
    await act(async () => root.render(<App repository={createProfileRepository(new IDBFactory())} accountService={service} />))
    await until(() => container.textContent?.includes('发送验证码') ?? false)
    await fill('邮箱', 'a@careertwin1.test')
    await act(async () => button('发送验证码').click())
    await fill('验证码', '000000')
    await act(async () => button('验证并登录').click())
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('已过期')
    expect(container.textContent).not.toContain('登录成功')
    expect(container.textContent).not.toContain('当前账号')
  })

  it('rejects a malformed cloud config and contains client creation failure', () => {
    const key = 'VITE_SUPABASE_PUBLISHABLE_KEY'
    expect(readCloudClientConfig({ VITE_SUPABASE_URL: 'not a url', [key]: 'k' })).toBeNull()
    expect(readCloudClientConfig({ VITE_SUPABASE_URL: 'http://cloud.example', [key]: 'k' })).toBeNull()
    expect(readCloudClientConfig({ VITE_SUPABASE_URL: 'https://ref.supabase.co/', [key]: 'k' })?.supabaseUrl).toBe('https://ref.supabase.co')
    expect(createDefaultAccountService({ VITE_SUPABASE_URL: 'not a url', [key]: 'k' })).toBeNull()
    expect(createDefaultAccountService({ VITE_SUPABASE_URL: 'https://ref.supabase.co', [key]: 'k' }, () => { throw new Error('boom') })).toBeNull()
  })

  it.each([
    ['a newer account', session('user-b', 'b@careertwin1.test'), 'b@careertwin1.test'],
    ['a newer sign-out', null, '发送验证码'],
  ])('an older session restoration cannot override %s event', async (_name, newer, expected) => {
    let finishRestore!: (value: Session | null) => void
    const { service, pending, emit } = fakeService(new Promise<Session | null>(resolve => { finishRestore = resolve }))
    await act(async () => root.render(<App repository={createProfileRepository(new IDBFactory())} accountService={service} />))
    await emit(newer)
    await until(() => container.textContent?.includes(expected) ?? false)
    pending.splice(0)
    await act(async () => finishRestore(session('user-a', 'a@careertwin1.test')))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(container.textContent).not.toContain('a@careertwin1.test')
    expect(container.textContent).toContain(expected)
    expect(pending.some(item => item.token === 'token-user-a')).toBe(false)
  })

  it('a late response for account A is never shown after switching to account B', async () => {
    const { service, pending, emit } = fakeService(session('user-a', 'a@careertwin1.test'))
    await act(async () => root.render(<App repository={createProfileRepository(new IDBFactory())} accountService={service} />))
    await until(() => pending.length === 2)
    const lateA = pending.splice(0)
    await emit(session('user-b', 'b@careertwin1.test'))
    await until(() => pending.length === 2)
    for (const item of lateA) await respond(item, 'user-a', 'a@careertwin1.test')
    expect(container.textContent).not.toContain('a@careertwin1.test')
    expect(container.textContent).toContain('b@careertwin1.test')
    for (const item of pending.splice(0)) await respond(item, 'user-b', 'b@careertwin1.test')
    expect(container.querySelector('[aria-label="云端连接状态"]')!.textContent).toContain('b@careertwin1.test')
    expect(container.textContent).not.toContain('user-a')
  })

  it('sign-out clears cloud results, and a response arriving after sign-out is discarded', async () => {
    const { service, pending } = fakeService(session('user-a', 'a@careertwin1.test'))
    await act(async () => root.render(<App repository={createProfileRepository(new IDBFactory())} accountService={service} />))
    await until(() => pending.length === 2)
    for (const item of pending.splice(0)) await respond(item, 'user-a', 'a@careertwin1.test')
    expect(container.textContent).toContain('云端私有 Profile 可访问')
    await act(async () => button('检查云端连接').click())
    await until(() => pending.length === 2)
    await act(async () => button('退出登录').click())
    await until(() => container.textContent?.includes('已退出云端账号') ?? false)
    for (const item of pending.splice(0)) await respond(item, 'user-a', 'a@careertwin1.test')
    expect(container.textContent).not.toContain('云端私有 Profile 可访问')
    expect(container.textContent).not.toContain('a@careertwin1.test')
    expect(container.textContent).toContain('发送验证码')
  })
})
