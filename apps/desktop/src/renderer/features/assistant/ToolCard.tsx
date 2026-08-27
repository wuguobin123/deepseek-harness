/**
 * Tool activity card — one inline row per tool invocation.
 *
 * Mirrors the webUI's `ToolCallTree` visual vocabulary: chevron + tool
 * name + status pill, collapsed by default, click to reveal input / output
 * JSON. Status uses the existing `.badge--{running|completed|failed|killed}`
 * variants (see `styles.css:7497-7516`) so the colour palette stays
 * consistent with TasksPage.
 */
import React from 'react'
import type { ToolEvent } from './types'

interface ToolCardProps {
  event: ToolEvent
}

const STATUS_LABEL: Record<ToolEvent['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function formatDuration(startedAt: number, finishedAt?: number): string {
  const end = finishedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function safeStringify(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserializable value]'
  }
}

export function ToolCard({ event }: ToolCardProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const duration = formatDuration(event.startedAt, event.finishedAt)

  return (
    <article
      className="tool-card"
      data-testid="assistant-tool-card"
      data-tool-name={event.name}
      data-tool-status={event.status}
    >
      <button
        type="button"
        className="tool-card__header"
        aria-expanded={open}
        onClick={() =>{  setOpen(prev => !prev) }}
      >
        <span className="tool-card__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="tool-card__name">{event.name}</span>
        <span className={`badge badge--${event.status}`} data-testid="assistant-tool-status">
          {STATUS_LABEL[event.status]}
        </span>
        <span className="tool-card__meta">{duration}</span>
      </button>
      {open ? (
        <div className="tool-card__body">
          {event.input !== undefined ? (
            <section className="tool-card__section">
              <h4 className="tool-card__label">输入</h4>
              <pre className="tool-card__pre">{safeStringify(event.input)}</pre>
            </section>
          ) : null}
          {event.error ? (
            <section className="tool-card__section">
              <h4 className="tool-card__label">错误</h4>
              <pre className="tool-card__pre tool-card__pre--error">{event.error}</pre>
            </section>
          ) : null}
          {event.output !== undefined ? (
            <section className="tool-card__section">
              <h4 className="tool-card__label">输出</h4>
              <pre className="tool-card__pre">{safeStringify(event.output)}</pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
