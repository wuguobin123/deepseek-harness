/**
 * Approval queue panel.
 *
 * Re-implements webUI's `<ApprovalQueue>` and replaces the legacy
 * `ApprovalsPage`. The list is keyed by `pendingInteraction.id`
 * (delegations awaiting user consent); entries are surfaced from
 * `ctx.pending.list()` and dismissed through `ctx.pending.respond(...)`.
 */

export interface PendingInteraction {
  id: string
  kind: 'approval' | 'choice' | 'form'
  title: string
  description?: string
  prompt?: string
  options?: Array<{ id: string; label: string; description?: string }>
  raisedAt: number
}

export interface ApprovalQueueProps {
  items: PendingInteraction[]
  onRespond: (id: string, choice: string) => void
  onDismiss: (id: string) => void
}

export function ApprovalQueue({ items, onRespond, onDismiss }: ApprovalQueueProps): React.JSX.Element {
  return (
    <section className="approval-queue" data-testid="approval-queue">
      <header className="approval-queue__header">
        <h2 className="approval-queue__title">待我处理</h2>
        <span className="approval-queue__count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="approval-queue__empty" data-testid="approval-queue-empty">没有待办事项</p>
      ) : (
        <ul className="approval-queue__list" data-testid="approval-queue-list">
          {items.map(item => (
            <li
              key={item.id}
              className={`approval-queue__item approval-queue__item--${item.kind}`}
              data-testid="approval-queue-item"
              data-interaction-id={item.id}
            >
              <header className="approval-queue__item-header">
                <h3 className="approval-queue__item-title">{item.title}</h3>
                <button type="button" className="ghost" data-testid="approval-queue-dismiss" onClick={() =>{  onDismiss(item.id) }}>
                  忽略
                </button>
              </header>
              {item.description ? <p className="approval-queue__item-desc">{item.description}</p> : null}
              {item.prompt ? <p className="approval-queue__item-prompt">{item.prompt}</p> : null}
              {item.options ? (
                <ul className="approval-queue__options">
                  {item.options.map(opt => (
                    <li key={opt.id}>
                      <button
                        type="button"
                        className="primary"
                        data-testid="approval-queue-option"
                        data-option-id={opt.id}
                        onClick={() =>{  onRespond(item.id, opt.id) }}
                      >
                        {opt.label}
                      </button>
                      {opt.description ? <span className="approval-queue__option-desc">{opt.description}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <button
                  type="button"
                  className="primary"
                  data-testid="approval-queue-respond"
                  onClick={() =>{  onRespond(item.id, 'approve') }}
                >
                  批准
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
