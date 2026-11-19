import pg from 'pg'

export interface Queryable { query: pg.Pool['query'] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function createPool(databaseUrl: string, databaseCa?: string, max = 3): pg.Pool {
  let connectionString = databaseUrl
  if (databaseCa) {
    // A connection-string sslmode would override the ssl object below.
    const url = new URL(databaseUrl)
    url.searchParams.delete('sslmode'); url.searchParams.delete('sslrootcert')
    connectionString = url.toString()
  }
  // Short-lived serverless connections; the transaction pooler keeps no session state between requests.
  const pool = new pg.Pool({
    connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, statement_timeout: 10_000,
    ...(databaseCa ? { ssl: { ca: databaseCa, rejectUnauthorized: true } } : {}),
  })
  pool.on('error', () => { /* idle client failures are reported per request; never log connection details */ })
  return pool
}

/**
 * Runs `work` in one transaction bound to the verified owner. set_config(..., true) is
 * transaction-local, so the binding ends at COMMIT or ROLLBACK and never survives on a pooled connection.
 */
export async function withOwner<T>(pool: pg.Pool, ownerId: string, work: (client: Queryable) => Promise<T>): Promise<T> {
  if (!UUID.test(ownerId)) throw new Error('Refusing to bind a non-UUID owner')
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('begin')
    await client.query("select set_config('app.user_id', $1, true)", [ownerId])
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    try { await client.query('rollback') } catch { broken = true }
    throw error
  } finally {
    client.release(broken)
  }
}
