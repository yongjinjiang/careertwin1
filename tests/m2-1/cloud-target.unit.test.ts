/** Non-mutating safety checks for the cloud harness target. Nothing here opens a connection. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { databaseTargetProblem, DEVELOPMENT_URL } from '../../scripts/test-m2-1-target.mjs'
import { createDisposableIdentity, type FixtureAdmin } from './cloud-fixtures'

const POOLER = 'aws-0-us-west-1.pooler.supabase.com'
const REF = 'ducpghchmqtdcvqwifgl'
const url = (user: string, host: string, query = '?sslmode=verify-full') => `postgresql://${user}:synthetic@${host}:6543/postgres${query}`

describe('M2.1 cloud harness database target', () => {
  it('accepts only the exact development pooler or direct host with the exact role', () => {
    expect(databaseTargetProblem(url(`careertwin1_app.${REF}`, POOLER))).toBeNull()
    expect(databaseTargetProblem(url('careertwin1_app', `db.${REF}.supabase.co`))).toBeNull()
  })

  it.each([
    ['another project suffix', url('careertwin1_app.otherprojectref000000', POOLER)],
    ['missing project suffix on the pooler', url('careertwin1_app', POOLER)],
    ['suffix on the direct host', url(`careertwin1_app.${REF}`, `db.${REF}.supabase.co`)],
    ['another direct host', url('careertwin1_app', 'db.otherprojectref000000.supabase.co')],
    ['another host', url(`careertwin1_app.${REF}`, 'aws-0-us-east-1.pooler.supabase.com')],
    ['privileged role', url(`postgres.${REF}`, POOLER)],
    ['query parameter overriding the host', url(`careertwin1_app.${REF}`, POOLER, '?sslmode=verify-full&host=db.example')],
    ['query parameter overriding the user', url(`careertwin1_app.${REF}`, POOLER, '?user=postgres')],
    ['duplicate TLS option', url(`careertwin1_app.${REF}`, POOLER, '?sslmode=verify-full&sslmode=disable')],
    ['unset', undefined],
  ])('rejects %s', (_name, value) => {
    expect(databaseTargetProblem(value)).toEqual(expect.any(String))
  })

  describe('fixture ownership', () => {
    const NEW_ID = 'fresh-identity'
    const EXISTING_ID = 'existing-identity'
    const stub = (overrides: Partial<FixtureAdmin>): FixtureAdmin => ({
      createUser: async () => ({ data: { user: { id: NEW_ID } }, error: null }),
      generateLink: async () => ({ data: { user: { id: NEW_ID }, properties: { email_otp: '123456' } }, error: null }),
      ...overrides,
    })
    const run = async (admin: FixtureAdmin) => {
      const tracked: string[] = []
      const outcome = await createDisposableIdentity(admin, 'm21@careertwin1.test', 'run', id => tracked.push(id)).then(value => value, error => error as Error)
      return { tracked, outcome }
    }

    it('tracks a freshly created identity and returns its code', async () => {
      const { tracked, outcome } = await run(stub({}))
      expect(tracked).toEqual([NEW_ID])
      expect(outcome).toEqual({ id: NEW_ID, code: '123456' })
    })

    it('never tracks an identity when creation fails, and does not ask for a code', async () => {
      const generateLink = vi.fn(stub({}).generateLink)
      const { tracked, outcome } = await run(stub({ createUser: async () => ({ data: { user: null }, error: { code: 'email_exists', status: 422 } }), generateLink }))
      expect(tracked).toEqual([])
      expect(outcome).toBeInstanceOf(Error)
      expect(generateLink).not.toHaveBeenCalled()
    })

    it('a code generated for another identity cannot schedule that identity for deletion', async () => {
      const { tracked, outcome } = await run(stub({ generateLink: async () => ({ data: { user: { id: EXISTING_ID }, properties: { email_otp: '123456' } }, error: null }) }))
      expect(tracked).toEqual([NEW_ID])
      expect(outcome).toBeInstanceOf(Error)
    })
  })

  it('the runner refuses a wrong target before starting any test', () => {
    const directory = mkdtempSync(join(tmpdir(), 'careertwin1-target-'))
    try {
      const file = join(directory, 'env')
      writeFileSync(file, [`SUPABASE_URL=${DEVELOPMENT_URL}`, 'SUPABASE_PUBLISHABLE_KEY=synthetic', 'M21_TEST_SUPABASE_ADMIN_KEY=synthetic', `CAREERTWIN1_DATABASE_URL=${url('careertwin1_app.otherprojectref000000', POOLER)}`].join('\n'))
      const result = spawnSync(process.execPath, ['scripts/test-m2-1-cloud.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH, M21_CLOUD_TESTS: '1', M21_ENV_FILE: file } })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('not the dedicated development project')
      expect(result.stdout + result.stderr).not.toContain('synthetic')
    } finally { rmSync(directory, { recursive: true }) }
  })
})
