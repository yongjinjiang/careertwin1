export const PROFILE_FORMAT_VERSION = 1 as const
export const BASIC_INFO_ID = 'basic_info' as const
export const BASIC_INFO_ORGANIZATION = 'basic info' as const

/** ISO 8601 UTC timestamps, produced with Date.toISOString(). */
export type Timestamp = string
export type ProjectId = `project:${string}`

interface RecordBase {
  formatVersion: typeof PROFILE_FORMAT_VERSION
  originalText: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ProjectRecord extends RecordBase {
  id: ProjectId
  type: 'project'
  displayName: string
  /** null means personal project; do not store the UI label as user data. */
  organization: string | null
  startYear: number | null
  endYear: number | null
  isCurrent: boolean
}

export interface BasicInfoRecord extends RecordBase {
  id: typeof BASIC_INFO_ID
  type: 'basic_info'
  displayName: 'Basic Info'
  organization: typeof BASIC_INFO_ORGANIZATION
  startYear?: never
  endYear?: never
  isCurrent?: never
}

export type ProfileRecord = ProjectRecord | BasicInfoRecord

/** Allocate once on creation; edits must keep the existing ID. */
export function createProjectId(): ProjectId {
  return `project:${crypto.randomUUID()}`
}
