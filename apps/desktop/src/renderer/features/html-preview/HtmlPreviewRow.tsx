/**
 * `html_build` / `slides_build` toolview row.
 *
 * Renders the result of a `html_build` or `slides_build` tool call as a
 * compact artifact card. The row replaces the generic tool row only when the call carries a `card: 'html'`
 * or `card: 'slides'` `resultView`; the running or generic-path call stays
 * on the default generic row.
 *
 * Clicking the card calls the typed conversation owner action that selects
 * the artifact and opens the shared details column. Keeping the row free of
 * an iframe prevents every transcript item from owning a browsing context.
 *
 * Bytes come from `api.artifact.read({ artifactId })`. The component does
 * not own the iframe srcDoc directly — `DocumentPreview` does, so the same
 * sanitization (script-block list for cross-tool reuse) lives in one place.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Minimal view of `block.resultView` for the `card: 'html' | 'slides'` arms.
 * Re-declared locally (rather than imported) so a UI rebuild that hasn't yet
 * pulled the latest `ToolResultView` union still renders. The `card` field
 * is the live wire value; we accept `unknown` here and narrow.
 */
type ArtifactCardView = {
  readonly card: 'html' | 'slides'
  readonly title?: string
  readonly artifactId: string
  readonly bytes: number
  readonly mediaType: string
}

function isArtifactCard(view: unknown): view is ArtifactCardView {
  if (!view) return false
  const v = view as { card?: unknown }
  if (v.card !== 'html' && v.card !== 'slides') return false
  const r = view as Partial<ArtifactCardView>
  return typeof r.artifactId === 'string'
    && r.artifactId.length > 0
    && typeof r.bytes === 'number'
    && typeof r.mediaType === 'string'
}

export interface HtmlPreviewRowProps {
  callId: string
  toolName: string
  block: ToolCallBlock
  cwd?: string | undefined
  home?: string | undefined
  openFile: (path: string) => void
  inspect?: (() => void) | undefined
  openArtifact?: ((artifactId: string) => void) | undefined
}

/**
 * Pure-React compact card for `html_build` / `slides_build`. The running-state
 * path renders an inert placeholder; the details column owns all previews.
 */
export function HtmlPreviewRow(props: HtmlPreviewRowProps): React.JSX.Element {
  const view: unknown = 'resultView' in props.block ? props.block.resultView : null
  const card = isArtifactCard(view) ? view : null
  if (!card) {
    return (
      <div className="html-preview-row html-preview-row--pending" data-testid="html-preview-row-pending" data-call-id={props.callId}>
        <span>等待产物…</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      className="html-preview-row"
      data-testid="html-preview-row"
      data-call-id={props.callId}
      data-artifact-id={card.artifactId}
      onClick={() => { props.openArtifact?.(card.artifactId) }}
    >
      <header className="html-preview-row__header">
        <span className="html-preview-row__title">{card.title ?? props.toolName}</span>
        <span className="html-preview-row__meta">{formatBytes(card.bytes)} · {card.mediaType}</span>
      </header>
      <span className="html-preview-row__action">点击预览 →</span>
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
