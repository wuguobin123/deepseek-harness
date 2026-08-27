/** Desktop last-location preference rendered in the Cordis General page. */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

type Environment = 'local' | 'cloud'

/** Select the Workspace group highlighted on the next launch without replacing either Host. */
export function EnvironmentSettingsRow(): React.JSX.Element {
  const [environment, setEnvironment] = useState<Environment>('local')
  const [baseUrl, setBaseUrl] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.workbenchApi.getSession().then((session) => {
      if (!active) return
      setEnvironment(session.lastLocation ?? session.environment ?? 'cloud')
      setBaseUrl(session.baseUrl)
      setBusy(false)
    }, (reason: unknown) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
    return () => { active = false }
  }, [])

  async function select(next: Environment): Promise<void> {
    if (next === environment) return
    setBusy(true)
    setError(null)
    const result = await window.workbenchApi.updateSession({ baseUrl, lastLocation: next })
    if (!result.ok) {
      setError(result.error.message)
      setBusy(false)
      return
    }
    setEnvironment(next)
    // Main reloads every real Electron window after the stream router has
    // switched. The assignment keeps component tests and non-Electron shims
    // coherent if their bridge does not reload the document.
    setBusy(false)
  }

  return (
    <div className="environment-settings-row" data-testid="environment-settings-row">
      <div className="environment-settings-row__copy">
        <div className="environment-settings-row__title">默认工作区位置</div>
        <div className="environment-settings-row__description">
          仅记录下次优先查看的位置；本机和云端工作区始终同时可用。
        </div>
        {error === null ? null : <div className="environment-settings-row__error" role="alert">{error}</div>}
      </div>
      <select
        aria-label="默认工作区位置"
        value={environment}
        disabled={busy}
        onChange={(event) => { void select(event.target.value as Environment) }}
      >
        <option value="local">本机工作区</option>
        <option value="cloud">云端工作区</option>
      </select>
    </div>
  )
}

/** Register the desktop environment selector after the General slot exists. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-environment',
    order: -100,
  }, EnvironmentSettingsRow))
}
