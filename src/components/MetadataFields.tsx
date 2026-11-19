import type { ProjectMetadata } from '../domain/projects'

export interface MetadataDraft { organization: string; startYear: string; endYear: string; isCurrent: boolean }
export function metadataDraft(value: ProjectMetadata): MetadataDraft {
  return { organization: value.organization ?? '', startYear: value.startYear?.toString() ?? '', endYear: value.endYear?.toString() ?? '', isCurrent: value.isCurrent }
}
export function parseMetadata(value: MetadataDraft): ProjectMetadata {
  const year = (text: string) => {
    if (!text.trim()) return null
    if (!/^\d{4}$/u.test(text)) throw new Error('年份请填写四位整数，或留空。')
    return Number(text)
  }
  return { organization: value.organization || null, startYear: year(value.startYear), endYear: value.isCurrent ? null : year(value.endYear), isCurrent: value.isCurrent }
}
export default function MetadataFields({ value, onChange }: { value: MetadataDraft; onChange: (value: MetadataDraft) => void }) {
  return <div className="metadata-fields">
    <label>单位 <span className="optional">可选，留空为个人项目</span><input value={value.organization} onChange={event => onChange({ ...value, organization: event.target.value })} autoComplete="organization" /></label>
    <div className="year-grid">
      <label>开始年份 <input inputMode="numeric" placeholder="可留空" value={value.startYear} onChange={event => onChange({ ...value, startYear: event.target.value })} /></label>
      <label>结束年份 <input inputMode="numeric" placeholder="可留空" disabled={value.isCurrent} value={value.endYear} onChange={event => onChange({ ...value, endYear: event.target.value })} /></label>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={value.isCurrent} onChange={event => onChange({ ...value, isCurrent: event.target.checked, endYear: event.target.checked ? '' : value.endYear })} />至今</label>
  </div>
}
