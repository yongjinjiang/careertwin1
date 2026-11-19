// Scans the production bundle for server-only values and secret-shaped strings. Prints names only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

const files = []
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}
if (!existsSync('dist')) {
  console.error('dist/ not found; run npm run build first.')
  process.exit(2)
}
walk('dist')
const bundle = files.map(file => readFileSync(file, 'latin1')).join('\n')

const env = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {}
const serverOnly = Object.entries(env).filter(([name, value]) => !name.startsWith('VITE_') && name !== 'SUPABASE_URL' && name !== 'SUPABASE_PUBLISHABLE_KEY' && value)
const leakedValues = serverOnly.filter(([, value]) => bundle.includes(value)).map(([name]) => name)
const patterns = { postgres_url: /postgres(ql)?:\/\/[^\s"'`]*@/u, secret_key: /sb_secret_[A-Za-z0-9_-]{8,}/u, server_env_name: /CAREERTWIN1_DATABASE_(URL|CA)|M21_TEST_SUPABASE_ADMIN_KEY/u }
const matched = Object.entries(patterns).filter(([, pattern]) => pattern.test(bundle)).map(([name]) => name)

console.log(JSON.stringify({ files: files.length, serverOnlyValuesChecked: serverOnly.length, leakedValues, matchedPatterns: matched }, null, 2))
process.exit(leakedValues.length || matched.length ? 1 : 0)
