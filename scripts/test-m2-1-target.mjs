// The one database target the mutating cloud harness may touch. Checked before any client or fixture exists.
export const DEVELOPMENT_URL = 'https://ducpghchmqtdcvqwifgl.supabase.co'
const REF = 'ducpghchmqtdcvqwifgl'
const ALLOWED_TARGETS = [
  { host: 'aws-0-us-west-1.pooler.supabase.com', user: `careertwin1_app.${REF}` },
  { host: `db.${REF}.supabase.co`, user: 'careertwin1_app' },
]
// pg lets query parameters override host, port, user and TLS, so only TLS file options are accepted.
const ALLOWED_QUERY = new Set(['sslmode', 'sslrootcert'])

/** Returns a reason (never containing the URL or its credentials) or null when the target is exact. */
export function databaseTargetProblem(value) {
  let url
  try { url = new URL(value ?? '') } catch { return 'database URL is not parseable' }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return 'database URL has the wrong protocol'
  const keys = [...url.searchParams.keys()]
  if (keys.some(key => !ALLOWED_QUERY.has(key)) || new Set(keys).size !== keys.length) return 'database URL has an unsupported or duplicate query parameter'
  let user
  try { user = decodeURIComponent(url.username) } catch { return 'database user is not decodable' }
  const match = ALLOWED_TARGETS.some(target => target.host === url.hostname && target.user === user)
  return match ? null : 'database host and user are not the dedicated development project'
}
