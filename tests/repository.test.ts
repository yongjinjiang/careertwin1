import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createProfileRepository } from '../src/storage/repository'
import { projectName, EMPTY_METADATA } from '../src/domain/projects'

describe('M1 persisted manual Profile', () => {
  it('reopens personal, organization and research-stage records without changing raw text', async () => {
    const factory = new IDBFactory()
    const repository = createProfileRepository(factory)
    const texts = [' 个人项目\n构建工具。 ', '单位项目\nBuilt a service.', '研究阶段\n整理研究与实验。']
    for (const [index, originalText] of texts.entries()) {
      await repository.createProject(`project:${index}`, { name: '', originalText })
    }
    await repository.updateProject('project:1', { metadata: { organization: 'Example Lab', startYear: 2022, endYear: 2025, isCurrent: false } })
    const reopened = await createProfileRepository(factory).load()
    expect(reopened.projects).toHaveLength(3)
    for (const [index, originalText] of texts.entries()) {
      expect(reopened.projects.find(record => record.id === `project:${index}`)?.originalText).toBe(originalText)
    }
    expect(reopened.projects.find(record => record.id === 'project:0')?.organization).toBeNull()
    expect(reopened.projects.find(record => record.id === 'project:1')?.organization).toBe('Example Lab')
  })

  it('handles simultaneous/retried same-ID creates once, refusing a different payload', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const input = { name: '', originalText: 'One original project' }
    const [first, second] = await Promise.all([
      repository.createProject('project:retry', input), repository.createProject('project:retry', input),
    ])
    expect(second).toEqual(first)
    await expect(repository.createProject('project:retry', { ...input, originalText: 'Different project' })).rejects.toThrow()
    expect((await repository.load()).projects).toEqual([first])
  })

  it('keeps saved notes through skipped or rejected metadata, then updates the same record', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const saved = await repository.createProject('project:metadata', { name: 'Example', originalText: 'Saved notes first.' })
    await expect(repository.updateProject(saved.id, { metadata: { ...EMPTY_METADATA, startYear: 2025, endYear: 2020 } })).rejects.toThrow()
    expect((await repository.load()).projects).toEqual([saved])
    const updated = await repository.updateProject(saved.id, { metadata: { organization: ' Lab ', startYear: 2022, endYear: null, isCurrent: true } })
    expect(updated.id).toBe(saved.id)
    expect(updated.createdAt).toBe(saved.createdAt)
    expect(updated.originalText).toBe(saved.originalText)
    expect(updated.organization).toBe('Lab')
    expect((await repository.load()).projects).toHaveLength(1)
  })

  it('overwrites only the selected record and preserves ID, createdAt and metadata by default', async () => {
    const repository = createProfileRepository(new IDBFactory())
    await repository.createProject('project:target', { name: 'Target', originalText: 'Old notes' })
    const target = await repository.updateProject('project:target', { metadata: { organization: 'Example Co', startYear: 2020, endYear: null, isCurrent: true } })
    const other = await repository.createProject('project:other', { name: 'Other', originalText: 'Must stay unchanged' })
    const updated = await repository.updateProject(target.id, { name: '', originalText: 'New first line\nMore details' })
    expect(updated).toMatchObject({
      id: target.id, createdAt: target.createdAt, organization: target.organization,
      startYear: 2020, endYear: null, isCurrent: true, displayName: 'New first line',
    })
    expect(updated.updatedAt > target.updatedAt).toBe(true)
    const data = await repository.load()
    expect(data.projects).toHaveLength(2)
    expect(data.projects.find(record => record.id === other.id)).toEqual(other)
  })

  it('supports explicit metadata edits and rejects invalid years before writing', async () => {
    const repository = createProfileRepository(new IDBFactory())
    await repository.createProject('project:edit', { name: 'Edit', originalText: 'Editable notes' })
    const edited = await repository.updateProject('project:edit', { name: 'Edited', originalText: ' Updated notes\n ', metadata: { organization: 'Co', startYear: 2020, endYear: 2024, isCurrent: false } })
    for (const metadata of [{ ...EMPTY_METADATA, startYear: 22 }, { ...EMPTY_METADATA, endYear: 2024.5 }, { ...EMPTY_METADATA, isCurrent: true, endYear: 2026 }]) {
      await expect(repository.updateProject(edited.id, { metadata })).rejects.toThrow()
    }
    expect((await repository.load()).projects).toEqual([edited])
  })

  it('stores Basic Info as one long independent record, preserving its original creation time', async () => {
    const factory = new IDBFactory()
    const repository = createProfileRepository(factory)
    const first = await repository.saveBasicInfo('中'.repeat(600))
    const raw = '  Education\n' + '中'.repeat(650) + '\n '
    const updated = await repository.saveBasicInfo(raw)
    const data = await createProfileRepository(factory).load()
    expect(data.projects).toEqual([])
    expect(data.basicInfo).toEqual(updated)
    expect(updated).toMatchObject({ id: 'basic_info', type: 'basic_info', organization: 'basic info', originalText: raw, createdAt: first.createdAt })
    expect(updated).not.toHaveProperty('startYear')
    expect(updated).not.toHaveProperty('isCurrent')
    expect(updated.updatedAt > first.updatedAt).toBe(true)
  })

  it('rejects blank/overlimit notes without writing; accepts one unit and exactly 500', async () => {
    const repository = createProfileRepository(new IDBFactory())
    for (const originalText of ['', '，。 🎉', '中'.repeat(501)]) {
      await expect(repository.createProject('project:invalid', { name: '', originalText })).rejects.toThrow()
    }
    expect((await repository.load()).projects).toHaveLength(0)
    await repository.createProject('project:one', { name: '', originalText: '一' })
    await repository.createProject('project:500', { name: '', originalText: '中'.repeat(500) })
    expect((await repository.load()).projects).toHaveLength(2)
  })

  it('rejects a transaction aborted after put, retaining the previous persisted record', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const previous = await repository.saveBasicInfo('Prior content')
    const originalPut = FakeObjectStore.prototype.put
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = originalPut.apply(this, args)
      this.transaction.abort()
      return request
    })
    try { await expect(repository.saveBasicInfo('Unsaved new content')).rejects.toThrow() }
    finally { spy.mockRestore() }
    expect((await repository.load()).basicInfo).toEqual(previous)
  })

  it('deletes only the target and refuses to recreate a deleted edit target', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const target = await repository.createProject('project:delete', { name: '', originalText: 'Target' })
    const other = await repository.createProject('project:keep', { name: '', originalText: 'Keep' })
    const basic = await repository.saveBasicInfo('Basic')
    await repository.deleteProject(target.id)
    await expect(repository.updateProject(target.id, { originalText: 'Do not recreate' })).rejects.toThrow('已不存在')
    expect(await repository.load()).toEqual({ projects: [other], basicInfo: basic })
  })

  it('all CRUD operations open only the fixed new database', async () => {
    const factory = new IDBFactory()
    const spy = vi.spyOn(factory, 'open')
    const repository = createProfileRepository(factory)
    await repository.createProject('project:isolation', { name: '', originalText: 'Isolated' })
    await repository.updateProject('project:isolation', { originalText: 'Updated' })
    await repository.saveBasicInfo('Independent')
    await repository.load()
    await repository.deleteProject('project:isolation')
    expect(spy.mock.calls).toHaveLength(5)
    expect(spy.mock.calls.every(([name, version]) => name === 'careertwin1-profile' && version === 1)).toBe(true)
  })

  it('generates a deterministic first nonempty line name with a 40-code-point limit', () => {
    expect(projectName('', '\n  First line  \nOther line')).toBe('First line')
    expect(projectName(' Name ', 'Source')).toBe('Name')
    expect(projectName('', '𠀀'.repeat(41))).toBe('𠀀'.repeat(40) + '…')
  })
})
