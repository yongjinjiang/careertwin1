/** Server-only configuration. Never import this from src/: these values must not reach the browser bundle. */
export interface ServerConfig {
  supabaseUrl: string
  publishableKey: string
  databaseUrl: string
  /** PEM of the database CA; TLS is always certificate-verified when set. */
  databaseCa?: string
  /** Fixed issuer for this project's Auth; tokens from any other issuer are rejected before verification. */
  expectedIssuer: string
}

// pg lets query parameters override host, user and TLS, so only these two are accepted.
const ALLOWED_DATABASE_QUERY = new Set(['sslmode', 'sslrootcert'])

/** Non-local databases need verified TLS: sslmode=verify-full, or a CA enforced by createPool. */
function databaseUrlIsSafe(value: string, hasCa: boolean): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return false
  const keys = [...url.searchParams.keys()]
  // URLSearchParams.get reads the first duplicate while pg keeps the last, so duplicates are refused.
  if (keys.some(key => !ALLOWED_DATABASE_QUERY.has(key)) || new Set(keys).size !== keys.length) return false
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return true
  const mode = url.searchParams.get('sslmode')
  return mode === 'verify-full' || (hasCa && mode === null)
}

export type ConfigResult = { ok: true; config: ServerConfig } | { ok: false; missing: string[] }

export const SERVER_ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'CAREERTWIN1_DATABASE_URL'] as const

export function readServerConfig(env: Record<string, string | undefined>): ConfigResult {
  const missing = SERVER_ENV_NAMES.filter(name => !env[name]?.trim())
  if (missing.length) return { ok: false, missing }
  const supabaseUrl = env.SUPABASE_URL!.trim().replace(/\/+$/u, '')
  let url: URL
  try { url = new URL(supabaseUrl) } catch { return { ok: false, missing: ['SUPABASE_URL'] } }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { ok: false, missing: ['SUPABASE_URL'] }
  const databaseCa = env.CAREERTWIN1_DATABASE_CA?.trim().replace(/\\n/gu, '\n')
  if (!databaseUrlIsSafe(env.CAREERTWIN1_DATABASE_URL!.trim(), Boolean(databaseCa))) return { ok: false, missing: ['CAREERTWIN1_DATABASE_URL'] }
  return {
    ok: true,
    config: {
      ...(databaseCa ? { databaseCa } : {}),
      supabaseUrl,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY!.trim(),
      databaseUrl: env.CAREERTWIN1_DATABASE_URL!.trim(),
      expectedIssuer: `${supabaseUrl}/auth/v1`,
    },
  }
}
