import { createClient, type AuthError, type Session } from '@supabase/supabase-js'

/** Only public values: the project URL and publishable key. Server secrets never use the VITE_ prefix. */
export interface CloudClientConfig { supabaseUrl: string; publishableKey: string }

export function readCloudClientConfig(env: Record<string, string | undefined> = import.meta.env): CloudClientConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim().replace(/\/+$/u, '')
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!supabaseUrl || !publishableKey) return null
  let url: URL
  try { url = new URL(supabaseUrl) } catch { return null }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  return url.protocol === 'https:' || (local && url.protocol === 'http:') ? { supabaseUrl, publishableKey } : null
}

export interface AccountUser { id: string; email: string | null }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }
export interface CloudIdentity { user: AccountUser }
export interface CloudProfileSummary { ownerId: string; revision: number; records: { id: string; type: string }[] }

/** Everything the account page needs; tests inject a fake, the app uses Supabase Auth. */
export interface AccountService {
  getSession(): Promise<Session | null>
  onSessionChange(listener: (session: Session | null) => void): () => void
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
  fetchApi<T>(path: '/api/me' | '/api/profile', accessToken: string): Promise<ApiResult<T>>
}

export class AccountError extends Error {}

/** A bad cloud configuration must never stop the local Profile from rendering. */
export function createDefaultAccountService(
  env?: Record<string, string | undefined>,
  create: (config: CloudClientConfig) => AccountService = config => createAccountService(config),
): AccountService | null {
  const config = readCloudClientConfig(env)
  if (!config) return null
  try { return create(config) } catch { return null }
}

export function describeAuthError(error: Pick<AuthError, 'message' | 'status'> & { code?: string }): string {
  switch (error.code) {
    case 'otp_expired': return '验证码不正确或已过期。请检查后重试，或重新发送验证码。'
    case 'over_email_send_rate_limit': return '发送过于频繁，请稍后再重新发送。'
    case 'over_request_rate_limit': return '请求过于频繁，请稍后再试。'
    case 'email_address_invalid': case 'validation_failed': return '邮箱地址无效，请检查后重试。'
    case 'signup_disabled': case 'otp_disabled': return '当前不允许用验证码登录此邮箱。'
    case 'email_provider_disabled': return '云端未启用邮箱登录。'
  }
  if (error.status === 429) return '请求过于频繁，请稍后再试。'
  return '操作失败，请稍后重试。'
}

export function createAccountService(config: CloudClientConfig, fetchImpl: typeof fetch = (...args) => fetch(...args)): AccountService {
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { storageKey: 'careertwin1-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  const fail = (error: AuthError | null) => { if (error) throw new AccountError(describeAuthError(error)) }
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession()
      if (error) return null
      return data.session
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(session))
      return () => data.subscription.unsubscribe()
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
      fail(error)
    },
    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
      fail(error)
      if (!data.session) throw new AccountError('验证未完成，请重试。')
    },
    async signOut() {
      // Ends this browser's session only; other devices stay signed in.
      const { error } = await client.auth.signOut({ scope: 'local' })
      fail(error)
    },
    async fetchApi<T>(path: '/api/me' | '/api/profile', accessToken: string): Promise<ApiResult<T>> {
      try {
        const response = await fetchImpl(path, { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
        const body = await response.json().catch(() => ({}))
        return response.ok ? { ok: true, data: body as T } : { ok: false, status: response.status, error: String(body.error ?? 'request_failed') }
      } catch { return { ok: false, status: 0, error: 'network_error' } }
    },
  }
}
