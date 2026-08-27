/**
 * `doc_build` / `sheet_build` toolview row.
 *
 * Renders the result of a `doc_build` or `sheet_build` tool call as a compact
 * card. The bytes are semantic HTML (`text/html`); clicking opens the shared
 * right-side `DocumentPreview` surface.
 *
 * The row never reads artifact bytes. `DocumentPreview` owns that operation,
 * so the iframe sandbox and content policy live in one place.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

type ArtifactCardView = {
  readonly card: 'doc' | 'sheet'
  readonly title?: string
  readonly artifactId: string
  readonly bytes: number
  readonly mediaType: string
}

function isDocSheetCard(view: unknown): view is ArtifactCardView {
  if (!view) return false
  const v = view as { card?: unknown }
  if (v.card !== 'doc' && v.card !== 'sheet') return false
  const r = view as Partial<ArtifactCardView>
  return typeof r.artifactId === 'string'
    && r.artifactId.length > 0
    && typeof r.bytes === 'number'
    && typeof r.mediaType === 'string'
}

export interface DocPreviewRowProps {
  callId: string
  toolName: string
  block: ToolCallBlock
  cwd?: string | undefined
  home?: string | undefined
  openFile: (path: string) => void
  inspect?: (() => void) | undefined
  openArtifact?: ((artifactId: string) => void) | undefined
}

export function DocPreviewRow(props: DocPreviewRowProps): React.JSX.Element {
  const view: unknown = 'resultView' in props.block ? props.block.resultView : null
  const card = isDocSheetCard(view) ? view : null
  if (!card) {
    return (
      <div className="doc-preview-row doc-preview-row--pending" data-testid="doc-preview-row-pending" data-call-id={props.callId}>
        <span>等待产物…</span>
      </div>
    )
  }
  return (
    <button type="button" className="doc-preview-row" data-testid="doc-preview-row" data-call-id={props.callId} data-artifact-id={card.artifactId}
      onClick={() => { props.openArtifact?.(card.artifactId) }}>
      <header className="doc-preview-row__header">
        <span className="doc-preview-row__title">{card.title ?? props.toolName}</span>
        <span className="doc-preview-row__meta">{formatBytes(card.bytes)} · {card.mediaType}</span>
      </header>
      <span className="doc-preview-row__action">点击预览 →</span>
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
