import { useRef, useState } from 'react'
import type { ProjectId, ProjectRecord } from '../domain/profile'
import { describeProject, formatYears } from '../domain/projects'
import type { ProfileRepository } from '../storage/repository'
import { errorText, Message, type Feedback, type Guard } from './shared'

export default function ProjectList({ projects, repository, onEdit, onDeleted, onNew, guard }: {
  projects: ProjectRecord[]; repository: ProfileRepository; onEdit: (record: ProjectRecord) => void
  onDeleted: (id: ProjectId) => void; onNew: () => void; guard: Guard
}) {
  const lock = useRef(false)
  const [busyId, setBusyId] = useState<ProjectId | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  async function remove(project: ProjectRecord) {
    if (lock.current || !window.confirm('确认删除此项目？\n' + describeProject(project) + '\n删除后无法撤销。')) return
    lock.current = true; setBusyId(project.id); setFeedback(null); guard(false, true)
    try {
      await repository.deleteProject(project.id); onDeleted(project.id)
      setFeedback({ kind: 'success', text: '已删除：' + project.displayName })
    } catch (error) { setFeedback({ kind: 'error', text: '删除失败：' + errorText(error) }) }
    finally { lock.current = false; setBusyId(null); guard(false, false) }
  }
  return <section aria-label="项目列表">
    <div className="list-heading"><h2>项目经历 <span className="optional">{projects.length} 条</span></h2><button className="primary-button" type="button" disabled={busyId !== null} onClick={onNew}>新建项目</button></div>
    <Message feedback={feedback} />
    {projects.length === 0 ? <div className="card empty-state"><h3>从第一段经历开始</h3><p>具体项目，或一段工作与研究阶段的概括，都可以作为一条记录。</p><button className="secondary-button" type="button" onClick={onNew}>前往主页录入</button></div>
      : <div className="project-list">{projects.map(project => <article className="card project-item" key={project.id}>
        <div className="project-item-heading"><h3>{project.displayName}</h3><div className="project-item-actions"><button type="button" className="text-button" disabled={busyId !== null} onClick={() => onEdit(project)}>Edit · 编辑</button><button type="button" className="text-button danger-text" disabled={busyId !== null} onClick={() => void remove(project)}>{busyId === project.id ? '删除中…' : '删除'}</button></div></div>
        <p className="project-metadata">{project.organization ?? '个人项目'} <span>·</span> {formatYears(project)}</p>
        <p className="project-excerpt">{project.originalText}</p>
        <details><summary>查看全文</summary><p className="original-text">{project.originalText}</p></details>
      </article>)}</div>}
  </section>
}
