/**
 * Connection status indicator — sidebar rail.
 *
 * Re-implements webUI's `<ConnectionStatus>` occupant of
 * `sidebar.status`. Shows the live state of `ctx.connection` (idle /
 * connecting / ready / error) and the active host label.
 */

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'error'

export interface ConnectionStatusProps {
  state: ConnectionState
  hostLabel: string
  errorMessage?: string
  onReconnect: () => void
  onOpenTrustedHosts: () => void
}

export function ConnectionStatus({
  state,
  hostLabel,
  errorMessage,
  onReconnect,
  onOpenTrustedHosts,
}: ConnectionStatusProps): React.JSX.Element {
  return (
    <footer className="sidebar__status" data-testid="sidebar-connection-status" data-state={state}>
      <span className={`sidebar__status-dot sidebar__status-dot--${state}`} aria-hidden="true" />
      <span className="sidebar__status-label" data-testid="sidebar-connection-label">
        {hostLabel} · {state}
      </span>
      {errorMessage ? (
        <span className="sidebar__status-error" role="alert" data-testid="sidebar-connection-error">
          {errorMessage}
        </span>
      ) : null}
      <button type="button" className="ghost" data-testid="sidebar-reconnect" onClick={onReconnect}>
        重新连接
      </button>
      <button type="button" className="ghost" data-testid="sidebar-trusted-hosts" onClick={onOpenTrustedHosts}>
        受信主机
      </button>
    </footer>
  )
}
