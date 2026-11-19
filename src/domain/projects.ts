import type { ProjectRecord } from './profile'
import { validateProjectText } from './text'

export interface ProjectMetadata {
  organization: string | null
  startYear: number | null
  endYear: number | null
  isCurrent: boolean
}
export const EMPTY_METADATA: ProjectMetadata = { organization: null, startYear: null, endYear: null, isCurrent: false }

export function projectName(name: string, originalText: string): string {
  const explicit = name.trim()
  if (explicit) return explicit
  const firstLine = originalText.split(/\r?\n/u).find(line => line.trim())?.trim() ?? ''
  const characters = Array.from(firstLine)
  return characters.length > 40 ? characters.slice(0, 40).join('') + '…' : firstLine
}

export function assertProjectText(originalText: string): void {
  const { issues } = validateProjectText(originalText)
  if (issues.includes('empty')) throw new Error('请输入项目原文，不能仅包含空白、标点或符号。')
  if (issues.includes('too_long')) throw new Error('项目原文超过 500 字，请修改后再保存。输入已保留。')
}

export function validateMetadata(metadata: ProjectMetadata): ProjectMetadata {
  for (const year of [metadata.startYear, metadata.endYear]) {
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
      throw new Error('年份请填写 1000–9999 之间的四位整数，或留空。')
    }
  }
  if (metadata.isCurrent && metadata.endYear !== null) throw new Error('选择至今时请清空结束年份。')
  if (metadata.startYear !== null && metadata.endYear !== null && metadata.startYear > metadata.endYear) {
    throw new Error('开始年份不能晚于结束年份。')
  }
  return { ...metadata, organization: metadata.organization?.trim() || null }
}

export function formatYears(project: ProjectMetadata): string {
  if (project.isCurrent) return project.startYear === null ? '至今' : `${project.startYear}–至今`
  if (project.startYear !== null && project.endYear !== null) return `${project.startYear}–${project.endYear}`
  if (project.startYear !== null) return `${project.startYear} 起`
  if (project.endYear !== null) return `截至 ${project.endYear}`
  return '年份未填写'
}

export function describeProject(project: ProjectRecord): string {
  return `${project.displayName} · ${project.organization ?? '个人项目'} · ${formatYears(project)}`
}
