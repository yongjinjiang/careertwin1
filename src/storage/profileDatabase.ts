import { PROFILE_FORMAT_VERSION } from '../domain/profile'

export const PROFILE_DATABASE_NAME = 'careertwin1-profile'
export const PROFILE_DATABASE_VERSION = 1
export const PROFILE_RECORDS_STORE = 'records'
export const PROFILE_TYPE_INDEX = 'by-type'

export interface StorageInitialization {
  databaseName: typeof PROFILE_DATABASE_NAME
  databaseVersion: typeof PROFILE_DATABASE_VERSION
  formatVersion: typeof PROFILE_FORMAT_VERSION
}

/** Shared M0 schema connector. M1 transactions use this fixed database only. */
export function openProfileDatabase(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('当前浏览器不支持 IndexedDB。'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error | DOMException) => {
      settled = true
      reject(error)
    }
    const request = factory.open(PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(PROFILE_RECORDS_STORE, { keyPath: 'id' })
      store.createIndex(PROFILE_TYPE_INDEX, 'type', { unique: false })
    }
    request.onblocked = () => fail(new Error('本地存储初始化被其他标签页阻止，请关闭其他 CareerTwin1 标签页后重试。'))
    request.onerror = () => fail(request.error ?? new Error('无法初始化本地存储。'))
    request.onsuccess = () => {
      const database = request.result
      // A blocked request can succeed later; do not leave its connection open.
      if (settled) {
        database.close()
        return
      }
      try {
        const store = database.transaction(PROFILE_RECORDS_STORE, 'readonly').objectStore(PROFILE_RECORDS_STORE)
        const index = store.index(PROFILE_TYPE_INDEX)
        if (store.keyPath !== 'id' || index.keyPath !== 'type' || index.unique) {
          throw new Error('本地存储格式与 CareerTwin1 不一致。')
        }
        settled = true
        resolve(database)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('无法检查本地存储格式。'))
        database.close()
      }
    }
  })
}

export async function initializeProfileStorage(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<StorageInitialization> {
  const database = await openProfileDatabase(factory)
  database.close()
  return { databaseName: PROFILE_DATABASE_NAME, databaseVersion: PROFILE_DATABASE_VERSION, formatVersion: PROFILE_FORMAT_VERSION }
}
