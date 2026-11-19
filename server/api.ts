import type pg from 'pg'
import { AuthenticationError, bearerToken, supabaseUserLookup, verifyAccessToken, type UserLookup } from './auth'
import { readServerConfig, type ServerConfig } from './config'
import { createPool, withOwner } from './db'
import { readOwnProfile } from './profile'

export interface ApiDependencies {
  config: ServerConfig
  lookup: UserLookup
  pool: () => pg.Pool
}
export type ApiEnvironment = { ok: true; deps: ApiDependencies } | { ok: false; missing: string[] }

/** Request parameters that try to choose whose data is read. The verified subject alone decides that. */
const OWNER_SELECTORS = ['owner', 'owner_id', 'ownerid', 'user', 'user_id', 'userid', 'uid', 'sub', 'id']

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

let cached: { key: string; environment: ApiEnvironment } | null = null

/** Builds dependencies from server env once per process; the pool is created lazily on first DB use. */
export function apiEnvironment(env: Record<string, string | undefined>): ApiEnvironment {
  const result = readServerConfig(env)
  if (!result.ok) return { ok: false, missing: result.missing }
  const key = JSON.stringify(result.config)
  if (cached?.key === key) return cached.environment
  let pool: pg.Pool | null = null
  const environment: ApiEnvironment = {
    ok: true,
    deps: { config: result.config, lookup: supabaseUserLookup(result.config), pool: () => (pool ??= createPool(result.config.databaseUrl, result.config.databaseCa)) },
  }
  cached = { key, environment }
  return environment
}

export async function handleApiRequest(request: Request, environment: ApiEnvironment): Promise<Response> {
  const url = new URL(request.url)
  const route = url.pathname.replace(/\/+$/u, '')
  if (route !== '/api/me' && route !== '/api/profile') return json(404, { error: 'not_found' })
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { allow: 'GET', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  if ([...url.searchParams.keys()].some(key => OWNER_SELECTORS.includes(key.toLowerCase()))) return json(400, { error: 'owner_selector_not_allowed' })
  if (!environment.ok) return json(503, { error: 'cloud_not_configured' })
  const { config, lookup, pool } = environment.deps

  let user
  try {
    user = await verifyAccessToken(bearerToken(request.headers.get('authorization')), config, lookup)
  } catch (error) {
    if (error instanceof AuthenticationError) return json(401, { error: 'unauthorized', reason: error.reason })
    return json(401, { error: 'unauthorized', reason: 'rejected_token' })
  }

  if (route === '/api/me') return json(200, { user: { id: user.id, email: user.email } })
  try {
    const profile = await withOwner(pool(), user.id, readOwnProfile)
    return json(200, { ownerId: user.id, ...profile })
  } catch {
    // Database details can include connection info; report only a generic state.
    return json(503, { error: 'database_unavailable' })
  }
}
