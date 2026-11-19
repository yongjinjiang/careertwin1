/**
 * Real cloud development checks: role, RLS, Data API boundary and API isolation.
 * Mutating, so it runs only with M21_CLOUD_TESTS=1 (scripts/test-m2-1-cloud.mjs) against the exact
 * development project; once enabled, wrong or missing configuration fails instead of skipping.
 * Identities are synthetic, created through Auth's admin API with generated codes (no email is sent),
 * and only identities created by this run are deleted. SMTP delivery is NOT covered here.
 */
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiEnvironment, handleApiRequest, type ApiEnvironment } from '../../server/api'
import { readServerConfig } from '../../server/config'
import { createPool, withOwner, type Queryable } from '../../server/db'
import { databaseTargetProblem, DEVELOPMENT_URL } from '../../scripts/test-m2-1-target.mjs'
import { createDisposableIdentity, type FixtureAdmin } from './cloud-fixtures'

const enabled = process.env.M21_CLOUD_TESTS === '1'
const env = process.env as Record<string, string | undefined>

describe.skipIf(!enabled)('M2.1 cloud development project: role, RLS and API isolation', { timeout: 60_000 }, () => {
  let app: pg.Pool
  let appSingle: pg.Pool
  let admin: SupabaseClient
  let api: ApiEnvironment
  let publishableKey: string
  let adminKey: string
  const created: string[] = []
  const users: Record<'a' | 'b', { id: string; email: string; token: string }> = {} as never
  const runId = randomUUID()
  const domain = env.M21_TEST_EMAIL_DOMAIN ?? 'careertwin1.test'

  /** Real session from an admin-generated code; proves Auth and tokens, not email delivery. */
  async function session(label: string) {
    const email = `m21-${runId}-${label}@${domain}`
    const { id, code } = await createDisposableIdentity(admin.auth.admin as unknown as FixtureAdmin, email, runId, fresh => created.push(fresh))
    const client = createClient(DEVELOPMENT_URL, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    if (verified.error || !verified.data.session) throw new Error(`Fixture sign-in failed: ${verified.error?.code ?? 'no session'}`)
    if (verified.data.user?.id !== id) throw new Error('Fixture sign-in returned a different identity')
    return { id, email, token: verified.data.session.access_token, refreshToken: verified.data.session.refresh_token, client }
  }
  const project = (owner: string, overrides: Record<string, unknown> = {}) => ({
    owner_id: owner, id: `project:${randomUUID()}`, type: 'project', display_name: 'Synthetic', original_text: 'Synthetic notes',
    organization: null, start_year: null, end_year: null, is_current: false, ...overrides,
  })
  async function insert(db: Queryable, row: Record<string, unknown>) {
    const keys = Object.keys(row)
    return db.query(
      `insert into careertwin1_private.profile_records (${keys.join(', ')}, created_at, updated_at)
       values (${keys.map((_, index) => `$${index + 1}`).join(', ')}, now(), now())`,
      Object.values(row),
    )
  }
  /** Runs `work` in a transaction bound to `owner` (unbound when null) and always rolls back. */
  async function asOwner<T>(owner: string | null, work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await app.connect()
    try {
      await db.query('begin')
      if (owner) await db.query("select set_config('app.user_id', $1, true)", [owner])
      return await work(db)
    } finally { await db.query('rollback'); db.release() }
  }
  const sqlState = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code)
  const call = (path: string, token?: string) => handleApiRequest(new Request(`http://127.0.0.1:5181${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), api)

  beforeAll(async () => {
    expect(env.SUPABASE_URL?.replace(/\/+$/u, ''), 'only the dedicated development project is allowed').toBe(DEVELOPMENT_URL)
    expect(databaseTargetProblem(env.CAREERTWIN1_DATABASE_URL), 'database target must be the exact development project').toBeNull()
    expect(env.M21_TEST_SUPABASE_ADMIN_KEY, 'M21_TEST_SUPABASE_ADMIN_KEY is required').toBeTruthy()
    const config = readServerConfig(env)
    if (!config.ok) throw new Error(`Missing or unsafe server config: ${config.missing.join(', ')}`)
    publishableKey = config.config.publishableKey
    adminKey = env.M21_TEST_SUPABASE_ADMIN_KEY!
    api = apiEnvironment(env)
    app = createPool(config.config.databaseUrl, config.config.databaseCa, 4)
    appSingle = createPool(config.config.databaseUrl, config.config.databaseCa, 1)
    admin = createClient(DEVELOPMENT_URL, adminKey, { auth: { persistSession: false, autoRefreshToken: false } })
    for (const key of ['a', 'b'] as const) users[key] = await session(key)
    // Seeded through the restricted role, so this also proves WITH CHECK accepts the true owner.
    for (const key of ['a', 'b'] as const) {
      await withOwner(app, users[key].id, async db => {
        await insert(db, project(users[key].id, { id: `project:seed-${key}`, original_text: `Notes of ${key}` }))
        await db.query('insert into careertwin1_private.profile_state (owner_id) values ($1)', [users[key].id])
      })
    }
  }, 120_000)

  afterAll(async () => {
    const failures: string[] = []
    // Foreign keys cascade this run's private rows; nothing else is deleted.
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) failures.push(id)
    }
    await app?.end(); await appSingle?.end()
    if (failures.length) throw new Error(`Fixture cleanup failed for ${failures.length} synthetic user(s): ${failures.join(', ')}`)
  })

  it('runtime role is the restricted non-owner role and RLS is forced', async () => {
    const identity = await app.query('select current_user as name')
    expect(identity.rows[0].name).toBe('careertwin1_app')
    const role = await app.query(`select rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb from pg_roles where rolname = 'careertwin1_app'`)
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false })
    const tables = await app.query(`select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'careertwin1_private' and c.relkind = 'r' order by 1`)
    expect(tables.rows.map(row => row.relname)).toEqual(['profile_records', 'profile_state'])
    for (const row of tables.rows) {
      expect(row.owner).not.toBe('careertwin1_app')
      expect(row.relrowsecurity && row.relforcerowsecurity).toBe(true)
    }
    const memberships = await app.query(`select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'careertwin1_app'`)
    expect(memberships.rows[0].n).toBe(0)
  })

  it('SELECT returns only the bound owner; unbound returns nothing', async () => {
    expect((await asOwner(users.a.id, db => db.query('select id from careertwin1_private.profile_records'))).rows.map(r => r.id)).toEqual(['project:seed-a'])
    expect((await asOwner(users.b.id, db => db.query('select id from careertwin1_private.profile_records'))).rows.map(r => r.id)).toEqual(['project:seed-b'])
    expect((await asOwner(null, db => db.query('select id from careertwin1_private.profile_records'))).rowCount).toBe(0)
    expect((await asOwner(null, db => db.query('select owner_id from careertwin1_private.profile_state'))).rowCount).toBe(0)
  })

  it('INSERT for another owner or without context is rejected', async () => {
    expect(await asOwner(users.b.id, db => sqlState(insert(db, project(users.a.id))))).toBe('42501')
    expect(await asOwner(null, db => sqlState(insert(db, project(users.a.id))))).toBe('42501')
    expect(await asOwner(users.b.id, db => sqlState(db.query('insert into careertwin1_private.profile_state (owner_id) values ($1)', [users.a.id])))).toBe('42501')
  })

  it('UPDATE cannot touch other owners and cannot reassign owner_id', async () => {
    expect((await asOwner(users.b.id, db => db.query(`update careertwin1_private.profile_records set original_text = 'x' where id = 'project:seed-a'`))).rowCount).toBe(0)
    expect(await asOwner(users.a.id, db => sqlState(db.query(`update careertwin1_private.profile_records set owner_id = $1 where id = 'project:seed-a'`, [users.b.id])))).toBe('42501')
    expect(await asOwner(users.a.id, db => sqlState(db.query('update careertwin1_private.profile_state set owner_id = $1', [users.b.id])))).toBe('42501')
    expect((await asOwner(users.b.id, db => db.query('update careertwin1_private.profile_state set revision = 99 where owner_id = $1', [users.a.id]))).rowCount).toBe(0)
    const seed = await asOwner(users.a.id, db => db.query(`select owner_id, original_text from careertwin1_private.profile_records where id = 'project:seed-a'`))
    expect(seed.rows).toEqual([{ owner_id: users.a.id, original_text: 'Notes of a' }])
  })

  it('DELETE cannot remove other owners or act without context', async () => {
    expect((await asOwner(users.b.id, db => db.query(`delete from careertwin1_private.profile_records where id = 'project:seed-a'`))).rowCount).toBe(0)
    expect((await asOwner(null, db => db.query('delete from careertwin1_private.profile_records'))).rowCount).toBe(0)
    expect((await asOwner(users.a.id, db => db.query(`delete from careertwin1_private.profile_records where id = 'project:seed-a'`))).rowCount).toBe(1)
  })

  it('record shape: basic_info rejects NULL organization; personal project accepts it; one basic_info per user', async () => {
    const basic = (owner: string, organization: string | null) => ({ owner_id: owner, id: 'basic_info', type: 'basic_info', display_name: 'Basic Info', original_text: 'Edu', organization })
    expect(await asOwner(users.a.id, db => sqlState(insert(db, basic(users.a.id, null))))).toBe('23514')
    expect(await asOwner(users.a.id, db => sqlState(insert(db, basic(users.a.id, 'other'))))).toBe('23514')
    expect(await asOwner(users.a.id, db => sqlState(insert(db, project(users.a.id, { organization: null }))))).toBe('ok')
    expect(await asOwner(users.a.id, db => sqlState(insert(db, project(users.a.id, { id: 'basic_info' }))))).toBe('23514')
    expect(await asOwner(users.a.id, async db => {
      await insert(db, basic(users.a.id, 'basic info'))
      return sqlState(insert(db, basic(users.a.id, 'basic info')))
    })).toBe('23505')
    expect(await asOwner(users.b.id, db => sqlState(insert(db, basic(users.b.id, 'basic info'))))).toBe('ok')
  })

  it('one pooled connection alternating A and B leaks no identity; commit and rollback clear the binding', async () => {
    const owners = (db: Queryable) => db.query('select owner_id from careertwin1_private.profile_records').then(result => result.rows.map(row => row.owner_id))
    const unbound = async () => {
      const setting = await appSingle.query("select current_setting('app.user_id', true) as value")
      expect(setting.rows[0].value ?? '').toBe('')
      expect((await appSingle.query('select id from careertwin1_private.profile_records')).rowCount).toBe(0)
    }
    for (let round = 0; round < 5; round += 1) {
      for (const key of ['a', 'b'] as const) {
        const seen = await withOwner(appSingle, users[key].id, owners)
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every(owner => owner === users[key].id)).toBe(true)
        await unbound()
      }
    }
    await expect(withOwner(appSingle, users.a.id, async db => { await db.query('select 1/0') })).rejects.toThrow()
    await unbound()
  })

  it('Data API roles have no access to the private schema', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = await app.query(`select has_schema_privilege($1, 'careertwin1_private', 'USAGE') as schema_usage,
        has_table_privilege($1, 'careertwin1_private.profile_records', 'SELECT') as records, has_table_privilege($1, 'careertwin1_private.profile_state', 'SELECT') as state`, [role])
      expect(access.rows[0]).toEqual({ schema_usage: false, records: false, state: false })
    }
    for (const key of [publishableKey, adminKey]) {
      const response = await fetch(`${DEVELOPMENT_URL}/rest/v1/profile_records?select=*`, { headers: { apikey: key, 'accept-profile': 'careertwin1_private' } })
      expect(response.ok).toBe(false)
      expect(await response.text()).not.toContain('Notes of')
    }
  })

  it('API with real Auth tokens returns only the verified user and fails closed', async () => {
    const me = await call('/api/me', users.b.token)
    expect(me.status).toBe(200)
    expect((await me.json()).user.id).toBe(users.b.id)
    const profile = await (await call('/api/profile', users.b.token)).json()
    expect(profile.ownerId).toBe(users.b.id)
    expect(profile.records.map((record: { id: string }) => record.id)).toEqual(['project:seed-b'])
    expect((await call(`/api/profile?owner=${users.a.id}`, users.b.token)).status).toBe(400)
    expect((await call('/api/profile')).status).toBe(401)
    const [header, payload, signature] = users.b.token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const tamper = (change: Record<string, unknown>) => [header, Buffer.from(JSON.stringify({ ...claims, ...change })).toString('base64url'), signature].join('.')
    expect((await call('/api/profile', tamper({ sub: users.a.id }))).status).toBe(401)
    expect((await call('/api/me', tamper({ iss: 'https://other.supabase.co/auth/v1' }))).status).toBe(401)
    expect((await call('/api/me', tamper({ exp: 1 }))).status).toBe(401)
  })

  it('sign-out revokes the refresh token; the access token status is recorded, not assumed', async () => {
    const extra = await session('c')
    expect((await call('/api/me', extra.token)).status).toBe(200)
    expect((await extra.client.auth.signOut({ scope: 'local' })).error).toBeNull()
    const fresh = createClient(DEVELOPMENT_URL, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await fresh.auth.refreshSession({ refresh_token: extra.refreshToken })).error).toBeTruthy()
    // Supabase documents access tokens as valid until expiry; this reports what this project actually does.
    console.info(`[M2.1 cloud] /api/me after local sign-out with the old access token: ${(await call('/api/me', extra.token)).status}`)
  })
})
