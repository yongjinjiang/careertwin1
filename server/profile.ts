import type { Queryable } from './db'

/** Read-only view of the caller's private Profile; RLS limits every row to the bound owner. */
export interface CloudProfileRecord {
  id: string
  type: 'project' | 'basic_info'
  formatVersion: number
  displayName: string
  originalText: string
  organization: string | null
  startYear: number | null
  endYear: number | null
  isCurrent: boolean
  createdAt: string
  updatedAt: string
}
export interface CloudProfile { revision: number; records: CloudProfileRecord[] }

interface RecordRow {
  id: string; type: 'project' | 'basic_info'; format_version: number; display_name: string; original_text: string
  organization: string | null; start_year: number | null; end_year: number | null; is_current: boolean
  created_at: Date; updated_at: Date
}

export async function readOwnProfile(db: Queryable): Promise<CloudProfile> {
  const state = await db.query<{ revision: string }>('select revision from careertwin1_private.profile_state')
  const rows = await db.query<RecordRow>(
    `select id, type, format_version, display_name, original_text, organization, start_year, end_year, is_current, created_at, updated_at
       from careertwin1_private.profile_records order by updated_at desc, id`,
  )
  return {
    revision: state.rows.length ? Number(state.rows[0].revision) : 0,
    records: rows.rows.map(row => ({
      id: row.id, type: row.type, formatVersion: row.format_version, displayName: row.display_name,
      originalText: row.original_text, organization: row.organization, startYear: row.start_year,
      endYear: row.end_year, isCurrent: row.is_current,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    })),
  }
}
