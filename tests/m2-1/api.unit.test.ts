/** Unit tests with a mocked Auth lookup and no database: they check request handling, not real RLS. */
import { describe, expect, it, vi } from 'vitest'
import { handleApiRequest, type ApiEnvironment } from '../../server/api'
import { readServerConfig } from '../../server/config'
import { withOwner } from '../../server/db'
import type pg from 'pg'

const SUPABASE_URL = 'https://example-ref.supabase.co'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const config = { supabaseUrl: SUPABASE_URL, publishableKey: 'publishable', databaseUrl: 'postgresql://unused', expectedIssuer: `${SUPABASE_URL}/auth/v1` }

function token(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'ES256' })}.${part(claims)}.c2lnbmF0dXJl`
}
const valid = (sub = USER_A) => token({ iss: `${SUPABASE_URL}/auth/v1`, sub, exp: Math.floor(Date.now() / 1000) + 600 })

function environment(lookupUser: string | null = USER_A, rows: unknown[] = []): { environment: ApiEnvironment; lookup: ReturnType<typeof vi.fn>; bound: string[] } {
  const bound: string[] = []
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('set_config')) bound.push(String(params?.[0]))
      if (sql.includes('profile_records')) return { rows }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  const lookup = vi.fn(async () => lookupUser ? { id: lookupUser, email: 'a@careertwin1.test' } : null)
  return { environment: { ok: true, deps: { config, lookup, pool: () => ({ connect: async () => client }) as unknown as pg.Pool } }, lookup, bound }
}
const get = (path: string, authorization?: string) => new Request(`http://127.0.0.1:5181${path}`, { headers: authorization ? { authorization } : {} })

describe('M2.1 API request handling (mocked Auth, no database)', () => {
  it('rejects missing, malformed, wrong-issuer, expired and Auth-rejected tokens without reading data', async () => {
    const cases: [string | undefined, string][] = [
      [undefined, 'missing_token'],
      ['Bearer not-a-jwt', 'malformed_token'],
      [`Bearer ${token({ iss: 'https://other-ref.supabase.co/auth/v1', sub: USER_A, exp: 9e9 })}`, 'wrong_issuer'],
      [`Bearer ${token({ iss: `${SUPABASE_URL}/auth/v1`, sub: USER_A, exp: 1 })}`, 'expired_token'],
    ]
    for (const [authorization, reason] of cases) {
      const { environment: env, lookup, bound } = environment()
      const response = await handleApiRequest(get('/api/profile', authorization), env)
      expect(response.status).toBe(401)
      expect((await response.json()).reason).toBe(reason)
      expect(lookup).not.toHaveBeenCalled()
      expect(bound).toEqual([])
    }
    const rejected = environment(null)
    expect((await handleApiRequest(get('/api/profile', `Bearer ${valid()}`), rejected.environment)).status).toBe(401)
    expect(rejected.bound).toEqual([])
  })

  it('fails closed when Auth returns a different subject than the token claims', async () => {
    const { environment: env, bound } = environment(USER_B)
    expect((await handleApiRequest(get('/api/profile', `Bearer ${valid(USER_A)}`), env)).status).toBe(401)
    expect(bound).toEqual([])
  })

  it('binds only the verified subject and rejects request owner selectors', async () => {
    const { environment: env, bound } = environment(USER_A)
    expect((await handleApiRequest(get(`/api/profile?owner=${USER_B}`, `Bearer ${valid()}`), env)).status).toBe(400)
    expect((await handleApiRequest(get(`/api/profile?userId=${USER_B}`, `Bearer ${valid()}`), env)).status).toBe(400)
    expect(bound).toEqual([])
    const response = await handleApiRequest(get('/api/profile', `Bearer ${valid()}`), env)
    expect(response.status).toBe(200)
    expect(bound).toEqual([USER_A])
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns the verified identity from /api/me, 405 for writes and 404 for unknown routes', async () => {
    const { environment: env } = environment(USER_A)
    const me = await handleApiRequest(get('/api/me', `Bearer ${valid()}`), env)
    expect(await me.json()).toEqual({ user: { id: USER_A, email: 'a@careertwin1.test' } })
    expect((await handleApiRequest(new Request('http://127.0.0.1/api/profile', { method: 'POST', body: '{}' }), env)).status).toBe(405)
    expect((await handleApiRequest(get('/api/debug'), env)).status).toBe(404)
  })

  it('reports missing server configuration as 503 without exposing which secret values exist', async () => {
    expect(readServerConfig({})).toEqual({ ok: false, missing: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'CAREERTWIN1_DATABASE_URL'] })
    expect(readServerConfig({ SUPABASE_URL: 'http://evil.example', SUPABASE_PUBLISHABLE_KEY: 'k', CAREERTWIN1_DATABASE_URL: 'd' }).ok).toBe(false)
    const safe = { SUPABASE_URL: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: 'k' }
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: 'postgresql://u:p@db.example:6543/postgres?sslmode=no-verify' }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: 'postgresql://u:p@db.example:6543/postgres?sslmode=disable' }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: 'postgresql://u:p@db.example:6543/postgres?sslmode=verify-full' }).ok).toBe(true)
    // Verified TLS is mandatory for remote hosts: absent options, weaker modes and overriding parameters fail closed.
    const remote = 'postgresql://u:p@db.example:6543/postgres'
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: remote }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: `${remote}?sslmode=require` }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: remote, CAREERTWIN1_DATABASE_CA: 'pem' }).ok).toBe(true)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: `${remote}?sslmode=disable`, CAREERTWIN1_DATABASE_CA: 'pem' }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: `${remote}?sslmode=verify-full&ssl=false` }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: `${remote}?sslmode=verify-full&sslmode=disable` }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: `${remote}?sslmode=disable&sslmode=verify-full` }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/postgres?host=db.example' }).ok).toBe(false)
    expect(readServerConfig({ ...safe, CAREERTWIN1_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/postgres' }).ok).toBe(true)
    const response = await handleApiRequest(get('/api/me', `Bearer ${valid()}`), { ok: false, missing: ['CAREERTWIN1_DATABASE_URL'] })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'cloud_not_configured' })
  })

  it('withOwner refuses a non-UUID owner before touching the database', async () => {
    const connect = vi.fn()
    await expect(withOwner({ connect } as unknown as pg.Pool, "x'; drop table", async () => 1)).rejects.toThrow()
    expect(connect).not.toHaveBeenCalled()
  })
})
