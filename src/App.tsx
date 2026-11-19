import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectId, ProjectRecord } from './domain/profile'
import { createProfileRepository, type ProfileRepository, type ProfileSnapshot } from './storage/repository'
import ProjectEditor from './components/ProjectEditor'
import ProjectList from './components/ProjectList'
import BasicInfoEditor from './components/BasicInfoEditor'
import AccountPage from './components/AccountPage'
import { createDefaultAccountService, type AccountService } from './auth/service'
import { errorText } from './components/shared'

type Page = 'home' | 'projects' | 'basic-info' | 'account'
const paths: Record<Page, string> = { home: '#/', projects: '#/profile/projects', 'basic-info': '#/profile/basic-info', account: '#/account' }
const defaultRepository = createProfileRepository()
const defaultAccountService = createDefaultAccountService()
/** Position of each app history entry, so a cancelled Back/Forward can return to it without rewriting history. */
type HistoryState = { careerTwin1Index: number }
function readHistoryIndex(): number | null {
  const index = (history.state as HistoryState | null)?.careerTwin1Index
  return typeof index === 'number' ? index : null
}
function readPage(): Page {
  if (location.hash === paths.projects) return 'projects'
  if (location.hash === paths['basic-info']) return 'basic-info'
  if (location.hash === paths.account) return 'account'
  return 'home'
}

export default function App({ repository = defaultRepository, accountService = defaultAccountService }: { repository?: ProfileRepository; accountService?: AccountService | null }) {
  const [page, setPage] = useState<Page>(readPage)
  const currentPage = useRef(page)
  const historyIndex = useRef(readHistoryIndex() ?? 0)
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({ projects: [], basicInfo: null })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editId, setEditId] = useState<ProjectId | null>(null)
  const [editorGeneration, setEditorGeneration] = useState(0)
  const pending = useRef({ dirty: false, busy: false })
  const guard = useCallback((dirty: boolean, busy: boolean) => { pending.current = { dirty, busy } }, [])

  function canLeave() {
    if (pending.current.busy) return false
    return !pending.current.dirty || window.confirm('有尚未保存的内容。确定离开并放弃这些修改吗？')
  }
  function navigate(next: Page, projectId: ProjectId | null = null, resetEditor = false) {
    if (next === currentPage.current && !resetEditor) return
    if (!canLeave()) return
    guard(false, false)
    setEditId(projectId)
    if (next === 'home') setEditorGeneration(value => value + 1)
    currentPage.current = next; setPage(next)
    historyIndex.current += 1
    history.pushState({ careerTwin1Index: historyIndex.current } satisfies HistoryState, '', paths[next])
  }

  useEffect(() => {
    if (readHistoryIndex() === null) history.replaceState({ careerTwin1Index: historyIndex.current } satisfies HistoryState, '')
    // Same-hash traversal fires only popstate; hash traversal fires popstate and hashchange. Handle both once.
    let cancelled: string | null = null
    const onTraverse = () => {
      const next = readPage()
      const index = readHistoryIndex()
      if (next === currentPage.current) { if (index !== null) historyIndex.current = index; cancelled = null; return }
      const key = `${location.href}|${index}`
      if (key === cancelled) return
      if (!canLeave()) {
        // Traverse back to the entry we came from; an unstamped entry is a newly typed hash after it.
        const delta = index === null ? -1 : historyIndex.current - index
        if (delta === 0) history.replaceState({ careerTwin1Index: historyIndex.current } satisfies HistoryState, '', paths[currentPage.current])
        else { cancelled = key; history.go(delta) }
        return
      }
      if (index === null) {
        historyIndex.current += 1
        history.replaceState({ careerTwin1Index: historyIndex.current } satisfies HistoryState, '')
      } else historyIndex.current = index
      guard(false, false); setEditId(null)
      if (next === 'home') setEditorGeneration(value => value + 1)
      currentPage.current = next; setPage(next)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.dirty || pending.current.busy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('popstate', onTraverse)
    window.addEventListener('hashchange', onTraverse)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('popstate', onTraverse); window.removeEventListener('hashchange', onTraverse)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [guard])

  useEffect(() => {
    let active = true
    setStatus('loading')
    repository.load().then(
      data => { if (active) { setSnapshot(data); setStatus('ready') } },
      error => { if (active) { setLoadError(errorText(error)); setStatus('error') } },
    )
    return () => { active = false }
  }, [repository, attempt])

  const saveProject = (record: ProjectRecord) => setSnapshot(previous => ({
    ...previous,
    projects: [record, ...previous.projects.filter(item => item.id !== record.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
  }))
  function link(event: React.MouseEvent<HTMLAnchorElement>, next: Page) {
    event.preventDefault(); navigate(next)
  }
  const onNew = () => navigate('home', null, true)

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>跳到主要内容</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#/" onClick={event => link(event, 'home')} aria-label="CareerTwin1 主页"><span className="brand-mark">ct</span>CareerTwin<span className="brand-number">1</span></a>
      <nav className="main-nav" aria-label="主导航">
        <a href="#/" onClick={event => link(event, 'home')} aria-current={page === 'home' ? 'page' : undefined}>主页</a>
        <a href="#/profile/projects" onClick={event => link(event, 'projects')} aria-current={page === 'projects' || page === 'basic-info' ? 'page' : undefined}>我的 Profile</a>
        <a href="#/account" onClick={event => link(event, 'account')} aria-current={page === 'account' ? 'page' : undefined}>账号</a>
      </nav><span className="phase-badge">本地个人经历库</span>
    </div></header>

    <main id="main-content" tabIndex={-1}>
      <div className="page-heading"><p className="eyebrow">YOUR EXPERIENCE, IN YOUR WORDS</p><h1>{page === 'home' ? '从自己的经历开始' : page === 'account' ? '云端账号' : '我的 Profile'}</h1><p className="page-intro">{page === 'home' ? '用自己的文字记录项目、工作与研究经历。手动维护，不调用 AI。' : page === 'account' ? '登录云端账号并检查私有连接。本地 Profile 仍只保存在此浏览器。' : '浏览项目原文，维护你的经历与基本信息。'}</p></div>

      {page === 'account' && <AccountPage service={accountService} />}
      {page !== 'account' && status === 'loading' && <div className="card empty-state" role="status">正在读取本地资料…</div>}
      {page !== 'account' && status === 'error' && <div className="card empty-state"><p role="alert">本地资料读取失败：{loadError}</p><button className="secondary-button" type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
      {page !== 'account' && status === 'ready' && (page === 'home' ? <div className="home-grid">
        <ProjectEditor key={editorGeneration} project={snapshot.projects.find(item => item.id === editId) ?? null} projects={snapshot.projects} repository={repository} onSaved={saveProject} onNew={onNew} guard={guard} />
        <aside className="card profile-guide"><p className="eyebrow">MY PROFILE</p><h2>一个地方，整理经历</h2><div className="guide-item"><span>01</span><div><h3>项目</h3><p>具体项目，或一段工作与研究阶段的概括。已保存 {snapshot.projects.length} 条。</p></div></div><div className="guide-item"><span>02</span><div><h3>Basic Info</h3><p>教育、联系方式、证书与偏好，集中自由编辑。</p></div></div><a className="text-link" href="#/profile/projects" onClick={event => link(event, 'projects')}>查看我的 Profile <span aria-hidden="true">→</span></a></aside>
      </div> : <section aria-label="Profile 内容">
        <nav className="profile-tabs" aria-label="Profile 分类"><a href="#/profile/projects" onClick={event => link(event, 'projects')} aria-current={page === 'projects' ? 'page' : undefined}>项目</a><a href="#/profile/basic-info" onClick={event => link(event, 'basic-info')} aria-current={page === 'basic-info' ? 'page' : undefined}>Basic Info</a></nav>
        {page === 'projects'
          ? <ProjectList projects={snapshot.projects} repository={repository} onEdit={record => navigate('home', record.id, true)} onDeleted={id => setSnapshot(previous => ({ ...previous, projects: previous.projects.filter(item => item.id !== id) }))} onNew={onNew} guard={guard} />
          : <BasicInfoEditor record={snapshot.basicInfo} repository={repository} onSaved={basicInfo => setSnapshot(previous => ({ ...previous, basicInfo }))} guard={guard} />}
      </section>)}
      {status === 'ready' && <div className="storage-status" role="status"><span className="status-dot ready" aria-hidden="true" />本地存储已就绪 · 当前浏览器独立保存，未同步到云端</div>}
    </main>
    <footer><span>CareerTwin1</span><span>资料来源始终是你的原文</span></footer>
  </div>
}
