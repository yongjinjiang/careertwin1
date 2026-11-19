// Docker-free cloud validation runner. Mutates the dedicated development project with disposable
// synthetic users, so it needs explicit enablement. Prints variable names only, never values.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { databaseTargetProblem, DEVELOPMENT_URL } from './test-m2-1-target.mjs'

const envFile = process.env.M21_ENV_FILE ?? '.env.local'
if (process.env.M21_CLOUD_TESTS !== '1') {
  console.error('Refusing to run: set M21_CLOUD_TESTS=1 to enable tests that write to the development project.')
  process.exit(2)
}
if (!existsSync(envFile)) {
  console.error(`Refusing to run: env file ${envFile} not found.`)
  process.exit(2)
}
const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env }
const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'CAREERTWIN1_DATABASE_URL', 'M21_TEST_SUPABASE_ADMIN_KEY'].filter(name => !env[name]?.trim())
if (missing.length) {
  console.error(`Refusing to run: missing ${missing.join(', ')}.`)
  process.exit(2)
}
if (env.SUPABASE_URL.trim().replace(/\/+$/u, '') !== DEVELOPMENT_URL) {
  console.error('Refusing to run: SUPABASE_URL is not the dedicated development project.')
  process.exit(2)
}
const problem = databaseTargetProblem(env.CAREERTWIN1_DATABASE_URL.trim())
if (problem) {
  console.error(`Refusing to run: ${problem}.`)
  process.exit(2)
}
const result = spawnSync('npx', ['vitest', 'run', 'tests/m2-1/database.cloud.test.ts'], { stdio: 'inherit', env })
process.exit(result.status ?? 1)
