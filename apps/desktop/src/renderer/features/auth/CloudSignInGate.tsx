/** Embedded cloud sign-in card with a shortcut to the local Workspace group. */
import { useState } from 'react'
import type { SessionState } from '../../../shared/contracts'
import { SignInCard } from './SignInCard'

interface EnvironmentBridge {
  getSession(): Promise<SessionState>
  updateSession(input: { baseUrl: string; lastLocation: 'local' | 'cloud' }): Promise<
    { ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }
  >
}

/** Render cloud authentication without trapping a signed-out user in cloud mode. */
export function CloudSignInGate({ api }: { api: EnvironmentBridge }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function returnLocal(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const session = await api.getSession()
      const result = await api.updateSession({ baseUrl: session.baseUrl, lastLocation: 'local' })
      if (!result.ok) {
        setError(result.error.message)
        setBusy(false)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  return (
    <div className="cloud-signin-gate">
      <SignInCard />
      <button type="button" disabled={busy} onClick={() => { void returnLocal() }} data-testid="return-local">
        {busy ? '正在定位…' : '查看本机工作区'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  )
}
