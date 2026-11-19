import { useRef, useState } from 'react'
import { createProjectId, type ProjectRecord, type ProjectId } from '../domain/profile'
import { describeProject, EMPTY_METADATA } from '../domain/projects'
import { countProfileText } from '../domain/text'
import type { ProfileRepository } from '../storage/repository'
import MetadataFields, { metadataDraft, parseMetadata } from './MetadataFields'
import { errorText, Message, useEditorGuard, type Feedback, type Guard } from './shared'

interface Props {
  project: ProjectRecord | null
  projects: ProjectRecord[]
  repository: ProfileRepository
  onSaved: (record: ProjectRecord) => void
  onNew: () => void
  guard: Guard
}

export default function ProjectEditor({ project, projects, repository, onSaved, onNew, guard }: Props) {
  const [saved, setSaved] = useState(project)
  const [name, setName] = useState(project?.displayName ?? '')
  const [originalText, setOriginalText] = useState(project?.originalText ?? '')
  const [metadata, setMetadata] = useState(() => metadataDraft(project ?? EMPTY_METADATA))
  const [metadataPending, setMetadataPending] = useState(false)
  const [showOverwrite, setShowOverwrite] = useState(false)
  const [overwriteId, setOverwriteId] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const newId = useRef<ProjectId | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const baselineMetadata = metadataDraft(saved ?? EMPTY_METADATA)
  const dirty = saved
    ? name !== saved.displayName || originalText !== saved.originalText || JSON.stringify(metadata) !== JSON.stringify(baselineMetadata)
    : name !== '' || originalText !== ''
  const count = countProfileText(originalText)
  useEditorGuard(dirty, busy, guard)

  function accept(record: ProjectRecord) {
    setSaved(record); setName(record.displayName); setOriginalText(record.originalText)
    setMetadata(metadataDraft(record)); onSaved(record)
  }

  async function save(kind: 'new' | 'edit' | 'overwrite' | 'metadata') {
    if (lock.current) return
    lock.current = true; setBusy(true); guard(dirty, true); setFeedback(null)
    try {
      let record: ProjectRecord
      if (kind === 'new') {
        newId.current ??= createProjectId()
        record = await repository.createProject(newId.current, { name, originalText })
      } else if (kind === 'overwrite') {
        if (!overwriteId) throw new Error('请先明确选择要覆盖的项目。')
        // Blank name keeps the target's existing name; only an explicit name renames it.
        record = await repository.updateProject(overwriteId as ProjectId, { name: name.trim() ? name : undefined, originalText })
      } else {
        if (!saved) throw new Error('未选择项目。')
        record = await repository.updateProject(saved.id, kind === 'metadata'
          ? { metadata: parseMetadata(metadata) }
          : { name, originalText, metadata: parseMetadata(metadata) })
      }
      accept(record)
      setShowOverwrite(false)
      setMetadataPending(kind === 'new')
      setFeedback({ kind: 'success', text: kind === 'new' ? '原文已保存。可以补充单位和年份，也可以跳过。' : kind === 'metadata' ? '补充信息已保存，项目原文保持不变。' : '项目已保存。' })
      guard(false, false)
    } catch (error) {
      setFeedback({ kind: 'error', text: kind === 'metadata' ? '原文已保存；补充信息保存失败：' + errorText(error) : '保存失败：' + errorText(error) })
    } finally { lock.current = false; setBusy(false) }
  }

  function skipMetadata() {
    if (!saved || busy) return
    setMetadata(metadataDraft(saved)); setMetadataPending(false)
    setFeedback({ kind: 'success', text: '已跳过补充信息，项目原文已保存。' })
    guard(false, false)
  }

  return <section className="card editor-card" aria-label="统一项目编辑器">
    <div className="card-heading"><h2>{saved ? '编辑项目' : '记录一段经历'}</h2><span className="subtle-tag">{saved ? '编辑模式' : '新建模式'}</span></div>
    <div className="form-body">
      {saved && <div className="editing-context"><p>正在编辑：<strong>{saved.displayName}</strong></p><p className="hint">{describeProject(saved)}</p><button type="button" className="text-button" disabled={busy} onClick={onNew}>切换为新建项目</button></div>}
      <form onSubmit={event => { event.preventDefault(); void save(saved ? 'edit' : 'new') }}>
        <fieldset disabled={busy || metadataPending}>
          <label>项目名称 <span className="optional">可选，留空使用原文首行</span><input value={name} onChange={event => setName(event.target.value)} /></label>
          <label>项目原文 <span className="optional">描述工作内容、个人贡献和结果</span><textarea rows={12} value={originalText} onChange={event => setOriginalText(event.target.value)} aria-describedby="project-count project-rule" /></label>
          <div className="text-info"><span id="project-rule">中文按字 · 英文按词 · 无最低字数</span><span id="project-count" className={count > 500 ? 'over-limit' : ''} aria-live="polite">{count} / 500</span></div>
          {count > 500 && <p className="field-error">已超过 500 字，输入会保留，请修改后再保存。</p>}
          {saved && !metadataPending && <MetadataFields value={metadata} onChange={setMetadata} />}
          <div className="actions">
            <button className="primary-button" type="submit">{busy ? '保存中…' : saved ? 'Save changes · 保存修改' : 'Save as new · 保存为新项目'}</button>
            {!saved && <button className="secondary-button" type="button" onClick={() => setShowOverwrite(value => !value)} aria-expanded={showOverwrite}>Overwrite existing · 覆盖已有项目</button>}
          </div>
        </fieldset>
      </form>
      {showOverwrite && !saved && <div className="overwrite-panel">
        <label>选择要覆盖的项目<select value={overwriteId} disabled={busy} onChange={event => setOverwriteId(event.target.value)}><option value="">请选择，不会自动选择目标</option>{projects.map(item => <option key={item.id} value={item.id}>{describeProject(item)}</option>)}</select></label>
        <p className="hint">将使用上方原文覆盖所选项目。名称留空时保留原名称，填写则改名。ID、创建时间、单位与年份会保留。</p>
        <button type="button" className="danger-button" disabled={busy || !overwriteId} onClick={() => void save('overwrite')}>覆盖：{projects.find(item => item.id === overwriteId)?.displayName ?? '请先选择项目'}</button>
        {projects.length === 0 && <p className="hint">尚无可覆盖项目，请先保存为新项目。</p>}
      </div>}
      {metadataPending && <section className="metadata-panel" aria-label="保存后的可选补充信息">
        <h3>原文已保存，补充信息可稍后再填</h3>
        <fieldset disabled={busy}><MetadataFields value={metadata} onChange={setMetadata} />
          <div className="actions"><button className="primary-button" type="button" onClick={() => void save('metadata')}>{busy ? '保存中…' : '保存补充信息'}</button><button className="secondary-button" type="button" onClick={skipMetadata}>跳过 / 取消补充</button></div>
        </fieldset>
      </section>}
      <Message feedback={feedback?.kind === 'success' && dirty ? null : feedback} />
      {dirty && <p className="hint" role="status">有未保存的修改</p>}
    </div>
  </section>
}
