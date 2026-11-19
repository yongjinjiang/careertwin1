// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createProfileRepository, type ProfileRepository } from '../src/storage/repository'
import type { ProjectRecord } from '../src/domain/profile'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  history.replaceState(null, '', '/#/')
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks()
})

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('UI wait timed out: ' + container.textContent)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
}
async function render(repository: ProfileRepository) {
  await act(async () => root.render(<App repository={repository} />))
  await until(() => Boolean(container.querySelector('textarea')))
}
function button(prefix: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(item => item.textContent?.startsWith(prefix))
  if (!element) throw new Error('Button not found: ' + prefix)
  return element
}
function field(prefix: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith(prefix))
  const input = label?.querySelector('input, textarea')
  if (!input) throw new Error('Field not found: ' + prefix)
  return input as HTMLInputElement | HTMLTextAreaElement
}
async function fill(prefix: string, value: string) {
  const input = field(prefix)
  await act(async () => {
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
function nav(label: string): HTMLAnchorElement {
  const element = [...container.querySelectorAll('a')].find(item => item.textContent === label)
  if (!element) throw new Error('Link not found: ' + label)
  return element
}

describe('M1 UI protects manual input and accurately reports persistence', () => {
  it('locks rapid duplicate submits, then skips metadata without duplicating the saved project', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const realCreate = repository.createProject
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const create = vi.spyOn(repository, 'createProject').mockImplementation(async (...args) => { await gate; return realCreate(...args) })
    await render(repository)
    await fill('项目原文', '  Original notes\nKept verbatim  ')
    const save = button('Save as new')
    await act(async () => { save.click(); save.click() })
    expect(create).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('保存中')
    await act(async () => release())
    await until(() => container.textContent?.includes('原文已保存') ?? false)
    expect(container.querySelectorAll('input[autocomplete=organization]')).toHaveLength(1)
    await click(button('跳过 / 取消补充'))
    const data = await repository.load()
    expect(data.projects).toHaveLength(1)
    expect(data.projects[0].originalText).toBe('  Original notes\nKept verbatim  ')
    expect(container.textContent).toContain('编辑模式')
    expect(container.textContent).not.toContain('Save as new')
  })

  it('retains input and reports failure, with no success before a successful retry', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const actual = repository.createProject
    const create = vi.spyOn(repository, 'createProject').mockRejectedValueOnce(new Error('Simulated quota failure')).mockImplementation(actual)
    await render(repository)
    await fill('项目原文', 'My unsaved input')
    await click(button('Save as new'))
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(field('项目原文').value).toBe('My unsaved input')
    expect(container.textContent).toContain('保存失败')
    expect(container.textContent).not.toContain('原文已保存')
    expect((await repository.load()).projects).toHaveLength(0)
    await click(button('Save as new'))
    await until(() => container.textContent?.includes('原文已保存') ?? false)
    expect(create.mock.calls[0][0]).toBe(create.mock.calls[1][0])
    expect((await repository.load()).projects).toHaveLength(1)
  })

  it('keeps the already-saved notes when metadata fails or is cancelled', async () => {
    const repository = createProfileRepository(new IDBFactory())
    vi.spyOn(repository, 'updateProject').mockRejectedValueOnce(new Error('Metadata write failed'))
    await render(repository)
    await fill('项目原文', 'Persist first')
    await click(button('Save as new'))
    await until(() => container.textContent?.includes('原文已保存') ?? false)
    await fill('单位', 'Example Lab')
    await click(button('保存补充信息'))
    await until(() => container.textContent?.includes('补充信息保存失败') ?? false)
    expect(field('单位').value).toBe('Example Lab')
    expect((await repository.load()).projects).toHaveLength(1)
    expect((await repository.load()).projects[0].originalText).toBe('Persist first')
    await click(button('跳过 / 取消补充'))
    expect((await repository.load()).projects[0].organization).toBeNull()
  })

  it('guards application navigation and explicit new-mode switches when dirty', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await render(repository)
    await fill('项目原文', 'Do not discard')
    await click(nav('我的 Profile'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(field('项目原文').value).toBe('Do not discard')
    expect(location.hash).toBe('#/')
    confirm.mockReturnValue(true)
    await click(nav('我的 Profile'))
    expect(container.textContent).toContain('项目经历')
    expect(location.hash).toBe('#/profile/projects')
  })

  it('browser Back cancel keeps the draft and the prior history entry; a later accepted Back reaches it', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await render(repository)
    await click(nav('我的 Profile'))
    await click(nav('主页'))
    await fill('项目原文', 'Draft kept across Back')
    await act(async () => history.back())
    await until(() => confirm.mock.calls.length === 1 && location.hash === '#/')
    expect(field('项目原文').value).toBe('Draft kept across Back')
    confirm.mockReturnValue(true)
    await act(async () => history.back())
    await until(() => location.hash === '#/profile/projects' && (container.textContent?.includes('项目经历') ?? false))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('Basic Info saves long text once, reports failure, and preserves the edit', async () => {
    const repository = createProfileRepository(new IDBFactory())
    await render(repository)
    await click(nav('我的 Profile')); await click(nav('Basic Info'))
    const raw = '中'.repeat(601)
    await fill('基本信息原文', raw)
    await click(button('保存 Basic Info'))
    await until(() => container.textContent?.includes('基本信息已保存') ?? false)
    await fill('基本信息原文', raw + '更新')
    vi.spyOn(repository, 'saveBasicInfo').mockRejectedValueOnce(new Error('Failed to commit'))
    await click(button('保存 Basic Info'))
    await until(() => Boolean(container.querySelector('[role="alert"]')))
    expect(field('基本信息原文').value).toBe(raw + '更新')
    expect(container.textContent).not.toContain('基本信息已保存')
    expect((await repository.load()).basicInfo?.originalText).toBe(raw)
    expect((await repository.load()).projects).toHaveLength(0)
  })

  it('same-hash Back keeps history positions, so a later cancel restores the original entry and prompts once per traversal', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const index = () => (history.state as { careerTwin1Index?: number } | null)?.careerTwin1Index
    await render(repository)
    await click(nav('我的 Profile'))
    await click(button('新建项目'))
    await fill('项目原文', 'Synthetic saved project')
    await click(button('Save as new'))
    await until(() => container.textContent?.includes('原文已保存') ?? false)
    await click(button('跳过 / 取消补充'))
    await click(button('切换为新建项目'))
    const newModeIndex = index()!
    await act(async () => history.back())
    await until(() => index() === newModeIndex - 1)
    expect(location.hash).toBe('#/')
    await fill('项目原文', 'Same-hash draft')
    await act(async () => history.back())
    await until(() => confirm.mock.calls.length === 1 && index() === newModeIndex - 1)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(field('项目原文').value).toBe('Same-hash draft')
    confirm.mockReturnValue(true)
    await act(async () => history.back())
    await until(() => location.hash === '#/profile/projects' && (container.textContent?.includes('项目经历') ?? false))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('Overwrite with a blank name keeps the target name; an explicit name renames it', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const target = await repository.createProject('project:overwrite-ui', { name: 'Named Target', originalText: 'Old notes' })
    await render(repository)
    async function overwrite(name: string, text: string) {
      await fill('项目名称', name); await fill('项目原文', text)
      await click(button('Overwrite existing'))
      const select = container.querySelector('select')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, target.id)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await click(button('覆盖：Named Target'))
      await until(() => container.textContent?.includes('项目已保存') ?? false)
    }
    await overwrite('   ', 'Updated first line\nMore notes')
    let record = (await repository.load()).projects[0]
    expect(record.displayName).toBe('Named Target')
    expect(record.originalText).toBe('Updated first line\nMore notes')
    expect(record.id).toBe(target.id)
    await click(button('切换为新建项目'))
    await overwrite('Renamed', 'Second notes')
    record = (await repository.load()).projects[0]
    expect(record.displayName).toBe('Renamed')
    expect((await repository.load()).projects).toHaveLength(1)
  })

  it('Edit loads the shared editor and rejected deletion leaves its target intact', async () => {
    const repository = createProfileRepository(new IDBFactory())
    const saved = await repository.createProject('project:edit-ui', { name: 'Target', originalText: 'Before edit' })
    await repository.updateProject(saved.id, { metadata: { organization: 'Lab', startYear: 2020, endYear: null, isCurrent: true } })
    await render(repository)
    await click(nav('我的 Profile'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await click(button('删除'))
    expect((await repository.load()).projects).toHaveLength(1)
    await click(button('Edit'))
    expect(field('项目原文').value).toBe('Before edit')
    expect(field('单位').value).toBe('Lab')
    await fill('项目原文', 'After edit')
    await click(button('Save changes'))
    await until(() => container.textContent?.includes('项目已保存') ?? false)
    const record: ProjectRecord = (await repository.load()).projects[0]
    expect(record.id).toBe(saved.id)
    expect(record.createdAt).toBe(saved.createdAt)
    expect(record.originalText).toBe('After edit')
    expect(record.organization).toBe('Lab')
  })
})
