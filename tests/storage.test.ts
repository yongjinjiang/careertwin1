import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { BASIC_INFO_ID, type BasicInfoRecord } from '../src/domain/profile'
import {
  initializeProfileStorage, PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION,
  PROFILE_RECORDS_STORE, PROFILE_TYPE_INDEX,
} from '../src/storage/profileDatabase'

function open(factory: IDBFactory, name: string, version: number, seed?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onupgradeneeded = () => seed?.(request.result)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

describe('isolated M0 schema initialization', () => {
  it('opens only the new database, leaves legacy versions and sentinel records untouched', async () => {
    const factory = new IDBFactory()
    const oldProfile = await open(factory, 'careertwin', 3, db => {
      db.createObjectStore('legacy').put({ original: 'old profile' }, 'sentinel')
    })
    const oldShares = await open(factory, 'careertwin-shares', 1, db => {
      db.createObjectStore('credentials').put('untouched', 'sentinel')
    })
    const spy = vi.spyOn(factory, 'open')

    await expect(initializeProfileStorage(factory)).resolves.toEqual({
      databaseName: 'careertwin1-profile', databaseVersion: 1, formatVersion: 1,
    })
    await initializeProfileStorage(factory)
    expect(spy.mock.calls).toEqual([
      ['careertwin1-profile', 1], ['careertwin1-profile', 1],
    ])
    expect(oldProfile.version).toBe(3)
    expect(oldShares.version).toBe(1)
    expect(Array.from(oldProfile.objectStoreNames)).toEqual(['legacy'])
    expect(Array.from(oldShares.objectStoreNames)).toEqual(['credentials'])
    expect(await result(oldProfile.transaction('legacy').objectStore('legacy').get('sentinel'))).toEqual({ original: 'old profile' })
    expect(await result(oldShares.transaction('credentials').objectStore('credentials').get('sentinel'))).toBe('untouched')
    oldProfile.close()
    oldShares.close()
  })

  it('creates an empty keyed records store and type index, without a synthetic Basic Info record', async () => {
    const factory = new IDBFactory()
    await initializeProfileStorage(factory)
    const db = await open(factory, PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION)
    expect(Array.from(db.objectStoreNames)).toEqual(['records'])
    const store = db.transaction(PROFILE_RECORDS_STORE).objectStore(PROFILE_RECORDS_STORE)
    expect(store.keyPath).toBe('id')
    expect(store.index(PROFILE_TYPE_INDEX).keyPath).toBe('type')
    expect(store.index(PROFILE_TYPE_INDEX).unique).toBe(false)
    expect(await result(store.count())).toBe(0)
    db.close()
  })

  it('reserves one Basic Info key and can store its text beyond the project limit', async () => {
    // Raw test fixtures demonstrate the storage contract; M0 exposes no record CRUD.
    const factory = new IDBFactory()
    await initializeProfileStorage(factory)
    const db = await open(factory, PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION)
    const timestamp = '2026-10-20T04:00:00.000Z'
    const fixture: BasicInfoRecord = {
      id: BASIC_INFO_ID, type: 'basic_info', displayName: 'Basic Info',
      organization: 'basic info', originalText: '中'.repeat(600),
      formatVersion: 1, createdAt: timestamp, updatedAt: timestamp,
    }
    const write = db.transaction(PROFILE_RECORDS_STORE, 'readwrite')
    const done = completed(write)
    write.objectStore(PROFILE_RECORDS_STORE).put(fixture)
    write.objectStore(PROFILE_RECORDS_STORE).put({ ...fixture, originalText: fixture.originalText + '更新' })
    await done
    const store = db.transaction(PROFILE_RECORDS_STORE).objectStore(PROFILE_RECORDS_STORE)
    const [count, saved] = await Promise.all([result(store.count()), result(store.get(BASIC_INFO_ID))])
    expect(count).toBe(1)
    expect(saved.originalText).toHaveLength(602)
    expect(saved.type).toBe('basic_info')
    db.close()
  })

  it('does not erase existing new-version data when initialization repeats', async () => {
    const factory = new IDBFactory()
    await initializeProfileStorage(factory)
    const db = await open(factory, PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION)
    const transaction = db.transaction(PROFILE_RECORDS_STORE, 'readwrite')
    const done = completed(transaction)
    transaction.objectStore(PROFILE_RECORDS_STORE).put({ id: 'project:sentinel', type: 'project', originalText: 'keep me' })
    await done
    db.close()
    await initializeProfileStorage(factory)
    const reopened = await open(factory, PROFILE_DATABASE_NAME, PROFILE_DATABASE_VERSION)
    expect(await result(reopened.transaction(PROFILE_RECORDS_STORE).objectStore(PROFILE_RECORDS_STORE).get('project:sentinel'))).toMatchObject({ originalText: 'keep me' })
    reopened.close()
  })

  it('reports unavailable IndexedDB instead of a successful initialization', async () => {
    vi.stubGlobal('indexedDB', undefined)
    try {
      await expect(initializeProfileStorage()).rejects.toThrow('不支持 IndexedDB')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an incompatible same-version schema without resetting it', async () => {
    const factory = new IDBFactory()
    const malformed = await open(factory, PROFILE_DATABASE_NAME, 1, db => { db.createObjectStore('unexpected') })
    malformed.close()
    await expect(initializeProfileStorage(factory)).rejects.toThrow()
    const after = await open(factory, PROFILE_DATABASE_NAME, 1)
    expect(Array.from(after.objectStoreNames)).toEqual(['unexpected'])
    after.close()
  })

  it('rejects a newer database without downgrading or deleting it', async () => {
    const factory = new IDBFactory()
    const newer = await open(factory, PROFILE_DATABASE_NAME, 2, db => { db.createObjectStore('future') })
    newer.close()
    await expect(initializeProfileStorage(factory)).rejects.toMatchObject({ name: 'VersionError' })
    const after = await open(factory, PROFILE_DATABASE_NAME, 2)
    expect(after.version).toBe(2)
    expect(Array.from(after.objectStoreNames)).toEqual(['future'])
    after.close()
  })

  it('closes initialization connections so a later delete is not blocked', async () => {
    const factory = new IDBFactory()
    await initializeProfileStorage(factory)
    await result(factory.deleteDatabase(PROFILE_DATABASE_NAME))
    expect(await factory.databases()).toEqual([])
  })
})
