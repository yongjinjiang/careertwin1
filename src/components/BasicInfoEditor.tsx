import { useRef, useState } from 'react'
import type { BasicInfoRecord } from '../domain/profile'
import type { ProfileRepository } from '../storage/repository'
import { errorText, Message, useEditorGuard, type Feedback, type Guard } from './shared'

export default function BasicInfoEditor({ record, repository, onSaved, guard }: {
  record: BasicInfoRecord | null; repository: ProfileRepository
  onSaved: (record: BasicInfoRecord) => void; guard: Guard
}) {
  const [text, setText] = useState(record?.originalText ?? '')
  const [baseline, setBaseline] = useState(record?.originalText ?? '')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  useEditorGuard(text !== baseline, busy, guard)
  async function save() {
    if (lock.current) return
    lock.current = true; setBusy(true); setFeedback(null); guard(text !== baseline, true)
    try {
      const saved = await repository.saveBasicInfo(text)
      setBaseline(saved.originalText); onSaved(saved); guard(false, false)
      setFeedback({ kind: 'success', text: '基本信息已保存。' })
    } catch (error) { setFeedback({ kind: 'error', text: '保存失败：' + errorText(error) }) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="card" aria-label="基本信息编辑器">
    <div className="card-heading"><h2>Basic Info</h2><span className="subtle-tag">独立基本信息</span></div>
    <form className="form-body" onSubmit={event => { event.preventDefault(); void save() }}>
      <p className="hint">教育、证书、奖项、联系方式、链接、所在地与工作偏好等，可以集中放在这里。不受项目的 500 字上限约束。</p>
      <label>基本信息原文<textarea rows={16} value={text} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      <div className="actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? '保存中…' : '保存 Basic Info'}</button><span className="hint">单条记录，反复保存会更新同一条资料。</span></div>
      <Message feedback={feedback?.kind === 'success' && text !== baseline ? null : feedback} />
      {text !== baseline && <p className="hint" role="status">有未保存的修改</p>}
    </form>
  </section>
}
