import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AccountService, ApiResult, CloudIdentity, CloudProfileSummary } from '../auth/service'
import { errorText, Message, type Feedback } from './shared'

const RESEND_SECONDS = 60
const CODE_PATTERN = /^\d{6}$/u

interface ConnectionCheck {
  userId: string
  me: ApiResult<CloudIdentity>
  profile: ApiResult<CloudProfileSummary>
}

function describeApiFailure(result: { status: number; error: string }): string {
  if (result.status === 0) return '无法连接云端接口。'
  if (result.error === 'cloud_not_configured') return '云端接口尚未配置。'
  if (result.error === 'database_unavailable') return '云端数据库暂不可用。'
  if (result.status === 401) return '登录凭证未通过服务端验证，请重新登录。'
  return `云端接口返回错误（${result.status}）。`
}

export default function AccountPage({ service }: { service: AccountService | null }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeEmail, setCodeEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [check, setCheck] = useState<ConnectionCheck | null>(null)
  const [checking, setChecking] = useState(false)
  // Identity the page currently shows; results for any other identity are discarded.
  const shownUser = useRef<string | null>(null)
  const checkGeneration = useRef(0)

  const applySession = useCallback((next: Session | null) => {
    const nextUser = next?.user.id ?? null
    if (nextUser !== shownUser.current) {
      shownUser.current = nextUser
      checkGeneration.current += 1
      setCheck(null); setChecking(false)
    }
    setSession(next)
  }, [])

  useEffect(() => {
    if (!service) return
    let active = true
    // Restoration is older than any auth event; once an event arrives, its late result is stale.
    let superseded = false
    const unsubscribe = service.onSessionChange(next => { if (active) { superseded = true; applySession(next) } })
    const restore = (next: Session | null) => { if (active && !superseded) applySession(next) }
    service.getSession().then(restore, () => restore(null))
    return () => { active = false; unsubscribe() }
  }, [service, applySession])

  useEffect(() => {
    if (resendAt <= now) return
    const timer = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(timer)
  }, [resendAt, now])

  const runCheck = useCallback(async (current: Session) => {
    if (!service) return
    const generation = ++checkGeneration.current
    const userId = current.user.id
    setChecking(true)
    const [me, profile] = await Promise.all([
      service.fetchApi<CloudIdentity>('/api/me', current.access_token),
      service.fetchApi<CloudProfileSummary>('/api/profile', current.access_token),
    ])
    // A late response for an earlier check or a different account must never be displayed.
    if (generation !== checkGeneration.current || shownUser.current !== userId) return
    setCheck({ userId, me, profile }); setChecking(false)
  }, [service])

  const signedInUser = session?.user.id ?? null
  useEffect(() => { if (session && signedInUser) void runCheck(session) }, [signedInUser])

  async function act(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setFeedback(null)
    try { await work() } catch (error) { setFeedback({ kind: 'error', text: errorText(error) }) } finally { setBusy(false) }
  }
  const sendCode = (target: string) => act(async () => {
    const trimmed = target.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) throw new Error('请输入有效的邮箱地址。')
    await service!.sendCode(trimmed)
    setCodeEmail(trimmed); setCode(''); setResendAt(Date.now() + RESEND_SECONDS * 1000); setNow(Date.now())
    setFeedback({ kind: 'success', text: `验证码已发送到 ${trimmed}。邮件到达后输入 6 位验证码；发送成功不代表已登录。` })
  })
  const verify = () => act(async () => {
    if (!CODE_PATTERN.test(code.trim())) throw new Error('请输入邮件中的 6 位数字验证码。')
    await service!.verifyCode(codeEmail!, code.trim())
    setCode(''); setCodeEmail(null)
    setFeedback({ kind: 'success', text: '登录成功。' })
  })
  const signOut = () => act(async () => {
    await service!.signOut()
    applySession(null)
    setFeedback({ kind: 'success', text: '已退出云端账号。本地 Profile 未受影响。' })
  })

  const localNotice = <p className="hint account-local-notice">本地 Profile 只保存在此浏览器，与云端账号互不关联：登录、退出都不会上传、迁移、关联或删除本地资料。云端 Profile 编辑尚未开放。</p>

  if (!service) return <section className="card account-card" aria-label="云端账号">
    <div className="card-heading"><h2>云端账号</h2><span className="subtle-tag">未配置</span></div>
    <div className="form-body"><p role="status">云端账号尚未配置或配置无效，暂时无法登录。本地 Profile 仍可正常使用。</p>{localNotice}</div>
  </section>

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))
  return <section className="card account-card" aria-label="云端账号">
    <div className="card-heading"><h2>云端账号</h2><span className="subtle-tag">{session ? '已登录' : session === null ? '未登录' : '读取中'}</span></div>
    <div className="form-body">
      {localNotice}
      {session === undefined && <p role="status">正在恢复登录状态…</p>}
      {session === null && !codeEmail && <form onSubmit={event => { event.preventDefault(); void sendCode(email) }}>
        <fieldset disabled={busy}>
          <label>邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <div className="actions"><button className="primary-button" type="submit">{busy ? '发送中…' : '发送验证码'}</button></div>
        </fieldset>
      </form>}
      {session === null && codeEmail && <form onSubmit={event => { event.preventDefault(); void verify() }}>
        <fieldset disabled={busy}>
          <p className="hint">验证码已发送至 <strong>{codeEmail}</strong></p>
          <label>验证码<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></label>
          <div className="actions">
            <button className="primary-button" type="submit">{busy ? '验证中…' : '验证并登录'}</button>
            <button className="secondary-button" type="button" disabled={waitSeconds > 0} onClick={() => void sendCode(codeEmail)}>{waitSeconds > 0 ? `重新发送（${waitSeconds} 秒）` : '重新发送验证码'}</button>
            <button className="text-button" type="button" onClick={() => { setCodeEmail(null); setCode(''); setFeedback(null) }}>更换邮箱</button>
          </div>
        </fieldset>
      </form>}
      {session && <div className="account-identity">
        <p>当前账号：<strong>{session.user.email ?? '（无邮箱）'}</strong></p>
        <p className="hint">账号 ID：<code>{session.user.id}</code></p>
        <div className="actions">
          <button className="secondary-button" type="button" disabled={busy || checking} onClick={() => void runCheck(session)}>{checking ? '检查中…' : '检查云端连接'}</button>
          <button className="danger-button" type="button" disabled={busy} onClick={() => void signOut()}>{busy ? '处理中…' : '退出登录'}</button>
        </div>
        {check && check.userId === session.user.id && <div className="connection-result" role="status" aria-label="云端连接状态">
          {check.me.ok
            ? <p>服务端已验证账号：{check.me.data.user.email ?? check.me.data.user.id}{check.me.data.user.id === session.user.id ? '' : '（与当前登录不一致）'}</p>
            : <p className="feedback error">账号验证失败：{describeApiFailure(check.me)}</p>}
          {check.profile.ok
            ? <p>云端私有 Profile 可访问：{check.profile.data.records.length} 条记录，版本 {check.profile.data.revision}（只读检查）。</p>
            : <p className="feedback error">云端 Profile 读取失败：{describeApiFailure(check.profile)}</p>}
        </div>}
      </div>}
      <Message feedback={feedback} />
    </div>
  </section>
}
