import {
  BASIC_INFO_ID, BASIC_INFO_ORGANIZATION, PROFILE_FORMAT_VERSION,
  type BasicInfoRecord, type ProfileRecord, type ProjectId, type ProjectRecord,
} from '../domain/profile'
import { assertProjectText, EMPTY_METADATA, projectName, validateMetadata, type ProjectMetadata } from '../domain/projects'
import { openProfileDatabase, PROFILE_RECORDS_STORE } from './profileDatabase'

export interface ProjectInput { name: string; originalText: string }
export interface ProjectUpdate { name?: string; originalText?: string; metadata?: ProjectMetadata }
export interface ProfileSnapshot { projects: ProjectRecord[]; basicInfo: BasicInfoRecord | null }
export interface ProfileRepository {
  load(): Promise<ProfileSnapshot>
  createProject(id: ProjectId, input: ProjectInput): Promise<ProjectRecord>
  updateProject(id: ProjectId, update: ProjectUpdate): Promise<ProjectRecord>
  deleteProject(id: ProjectId): Promise<void>
  saveBasicInfo(originalText: string): Promise<BasicInfoRecord>
}

function timestampAfter(previous?: string): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString()
}

/** Every operation resolves only after transaction completion, never request success. */
export function createProfileRepository(factory: IDBFactory | undefined = globalThis.indexedDB): ProfileRepository {
  async function transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore, setResult: (value: T) => void, fail: (error: Error) => void) => void,
  ): Promise<T> {
    const database = await openProfileDatabase(factory)
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = database.transaction(PROFILE_RECORDS_STORE, mode)
        let value: T
        let failure: Error | null = null
        const fail = (error: Error) => { failure = error; tx.abort() }
        tx.oncomplete = () => resolve(value)
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('本地存储事务已中止，资料未保存。'))
        tx.onerror = () => { failure ??= tx.error }
        try { action(tx.objectStore(PROFILE_RECORDS_STORE), result => { value = result }, fail) }
        catch (error) { fail(error instanceof Error ? error : new Error('本地存储操作失败。')) }
      })
    } finally { database.close() }
  }

  return {
    load: () => transaction('readonly', (store, done, fail) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const records = request.result as ProfileRecord[]
        if (records.some(record => record.formatVersion !== PROFILE_FORMAT_VERSION ||
          (record.type !== 'project' && record.type !== 'basic_info') ||
          (record.type === 'basic_info' && (record.id !== BASIC_INFO_ID || record.organization !== BASIC_INFO_ORGANIZATION)))) {
          fail(new Error('资料格式与当前版本不一致，未修改已存资料。'))
          return
        }
        done({
          projects: records.filter((record): record is ProjectRecord => record.type === 'project')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
          basicInfo: records.find((record): record is BasicInfoRecord => record.type === 'basic_info') ?? null,
        })
      }
    }),
    createProject: async (id, input) => {
      assertProjectText(input.originalText)
      const displayName = projectName(input.name, input.originalText)
      return transaction('readwrite', (store, done, fail) => {
        const get = store.get(id)
        get.onsuccess = () => {
          const existing = get.result as ProfileRecord | undefined
          if (existing) {
            if (existing.type === 'project' && existing.originalText === input.originalText && existing.displayName === displayName) {
              done(existing) // Retry of the same logical save is idempotent.
            } else { fail(new Error('此保存标识已存在不同内容，请重新打开项目后编辑。')) }
            return
          }
          const now = timestampAfter()
          const record: ProjectRecord = {
            id, type: 'project', formatVersion: PROFILE_FORMAT_VERSION, displayName,
            originalText: input.originalText, ...EMPTY_METADATA, createdAt: now, updatedAt: now,
          }
          store.add(record)
          done(record)
        }
      })
    },
    updateProject: async (id, update) => {
      if (update.originalText !== undefined) assertProjectText(update.originalText)
      const metadata = update.metadata ? validateMetadata(update.metadata) : undefined
      return transaction('readwrite', (store, done, fail) => {
        const get = store.get(id)
        get.onsuccess = () => {
          const previous = get.result as ProjectRecord | undefined
          if (!previous || previous.type !== 'project') { fail(new Error('该项目已不存在。输入已保留，请切换新建或重新选择项目。')); return }
          const originalText = update.originalText ?? previous.originalText
          const record: ProjectRecord = {
            ...previous,
            ...(metadata ?? {}),
            originalText,
            displayName: update.name === undefined ? previous.displayName : projectName(update.name, originalText),
            updatedAt: timestampAfter(previous.updatedAt),
          }
          store.put(record)
          done(record)
        }
      })
    },
    deleteProject: id => transaction('readwrite', (store, done, fail) => {
      const get = store.get(id)
      get.onsuccess = () => {
        if (!get.result || get.result.type !== 'project') { fail(new Error('该项目已不存在，请刷新列表。')); return }
        store.delete(id)
        done(undefined)
      }
    }),
    saveBasicInfo: originalText => transaction('readwrite', (store, done) => {
      const get = store.get(BASIC_INFO_ID)
      get.onsuccess = () => {
        const previous = get.result as BasicInfoRecord | undefined
        const now = timestampAfter(previous?.updatedAt)
        const record: BasicInfoRecord = {
          id: BASIC_INFO_ID, type: 'basic_info', formatVersion: PROFILE_FORMAT_VERSION,
          displayName: 'Basic Info', organization: BASIC_INFO_ORGANIZATION, originalText,
          createdAt: previous?.createdAt ?? now, updatedAt: now,
        }
        store.put(record)
        done(record)
      }
    }),
  }
}
