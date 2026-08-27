/**
 * Tool call row.
 *
 * Re-implements webUI's `<ToolCallTree>` keyed by `tool.call.toolview`.
 * One row per tool invocation; collapsed by default with a status pill
 * and elapsed time, click to reveal pretty-printed input/output JSON.
 *
 * Statuses map to the same vocabulary TasksPage used:
 *   - running    → accent pulse
 *   - completed  → success
 *   - failed     → error
 *   - cancelled  → neutral
 */
import React from 'react'

export type ToolStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ToolCallRowProps {
  callId: string
  toolName: string
  status: ToolStatus
  startedAt: number
  finishedAt?: number
  input?: unknown
  output?: unknown
  error?: { message: string }
}

export function ToolCallRow(props: ToolCallRowProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const elapsedMs = (props.finishedAt ?? Date.now()) - props.startedAt
  const elapsed = formatElapsed(elapsedMs)

  return (
    <article
      className={`tool-call-row tool-call-row--${props.status}`}
      data-testid="tool-call-row"
      data-call-id={props.callId}
      data-tool={props.toolName}
      data-status={props.status}
    >
      <button
        type="button"
        className="tool-call-row__header"
        data-testid="tool-call-row-header"
        aria-expanded={open}
        onClick={() =>{  setOpen(v => !v) }}
      >
        <span className="tool-call-row__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="tool-call-row__name">{props.toolName}</span>
        <span className={`tool-call-row__status tool-call-row__status--${props.status}`} data-testid="tool-call-row-status">
          {props.status}
        </span>
        <span className="tool-call-row__elapsed">{elapsed}</span>
      </button>
      {open ? (
        <div className="tool-call-row__body" data-testid="tool-call-row-body">
          <section className="tool-call-row__section">
            <h4 className="tool-call-row__section-label">输入</h4>
            <pre className="tool-call-row__pre">{formatJson(props.input)}</pre>
          </section>
          {props.error ? (
            <section className="tool-call-row__section tool-call-row__section--error">
              <h4 className="tool-call-row__section-label">错误</h4>
              <pre className="tool-call-row__pre tool-call-row__pre--error">{props.error.message}</pre>
            </section>
          ) : null}
          {props.output !== undefined ? (
            <section className="tool-call-row__section">
              <h4 className="tool-call-row__section-label">输出</h4>
              <pre className="tool-call-row__pre">{formatJson(props.output)}</pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function formatJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserializable value]'
  }
}
