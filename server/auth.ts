import { createClient } from '@supabase/supabase-js'
import type { ServerConfig } from './config'

export interface VerifiedUser { id: string; email: string | null }
export type UserLookup = (accessToken: string) => Promise<VerifiedUser | null>

export class AuthenticationError extends Error {
  constructor(readonly reason: 'missing_token' | 'malformed_token' | 'wrong_issuer' | 'expired_token' | 'rejected_token') {
    super(reason)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function bearerToken(header: string | null): string {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u)
  if (!header) throw new AuthenticationError('missing_token')
  if (!match) throw new AuthenticationError('malformed_token')
  return match[1]
}

/** Unverified claims, used only to fail fast on a wrong project or expiry before asking Auth. */
function unverifiedClaims(token: string): { iss?: unknown; exp?: unknown; sub?: unknown } {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch { throw new AuthenticationError('malformed_token') }
}

/** Supabase's server-side check: Auth itself validates the token and returns the current user. */
export function supabaseUserLookup(config: ServerConfig): UserLookup {
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return async accessToken => {
    const { data, error } = await client.auth.getUser(accessToken)
    if (error || !data.user) return null
    return { id: data.user.id, email: data.user.email ?? null }
  }
}

export async function verifyAccessToken(token: string, config: ServerConfig, lookup: UserLookup, now = Date.now()): Promise<VerifiedUser> {
  const claims = unverifiedClaims(token)
  if (claims.iss !== config.expectedIssuer) throw new AuthenticationError('wrong_issuer')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new AuthenticationError('expired_token')
  const user = await lookup(token).catch(() => null)
  // The verified subject must be a UUID and match the token it came from; anything else fails closed.
  if (!user || !UUID.test(user.id) || user.id !== claims.sub) throw new AuthenticationError('rejected_token')
  return user
}
