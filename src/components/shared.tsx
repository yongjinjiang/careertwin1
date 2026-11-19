import { useEffect } from 'react'

export type Guard = (dirty: boolean, busy: boolean) => void
export type Feedback = { kind: 'success' | 'error'; text: string } | null

export function useEditorGuard(dirty: boolean, busy: boolean, guard: Guard) {
  useEffect(() => { guard(dirty, busy); return () => guard(false, false) }, [dirty, busy, guard])
}

export function Message({ feedback }: { feedback: Feedback }) {
  return feedback && <p className={`feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，输入已保留，请重试。'
}
