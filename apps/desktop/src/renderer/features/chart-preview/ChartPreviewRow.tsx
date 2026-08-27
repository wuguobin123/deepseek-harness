/**
 * `mermaid_build` / `svg_build` toolview row.
 *
 * Renders the result of a chart tool call as a compact card. Two generators,
 * one row:
 *
 * - `generator: 'svg'` → the bytes are `image/svg+xml` and render as an inert
 *   image in the shared `DocumentPreview`.
 * - `generator: 'mermaid'` → the bytes are an `text/html` harness with the
 *   mermaid runtime inlined (no CDN). The row also defers to
 *   `DocumentPreview`; the harness owns the runtime + `<pre class="mermaid">`
 *   element, and the iframe's `sandbox="allow-scripts"` lets it run.
 *
 * The row only owns chart chrome (title, byte/media type and generator badge).
 * Artifact bytes and rendering stay in `DocumentPreview`.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

type ChartCardView = {
  readonly card: 'chart'
  readonly title?: string
  readonly artifactId: string
  readonly bytes: number
  readonly mediaType: string
  readonly generator: 'mermaid' | 'svg'
}

function isChartCard(view: unknown): view is ChartCardView {
  if (!view) return false
  const v = view as { card?: unknown; generator?: unknown }
  if (v.card !== 'chart') return false
  if (v.generator !== 'mermaid' && v.generator !== 'svg') return false
  const r = view as Partial<ChartCardView>
  return typeof r.artifactId === 'string'
    && r.artifactId.length > 0
    && typeof r.bytes === 'number'
    && typeof r.mediaType === 'string'
}

export interface ChartPreviewRowProps {
  callId: string
  toolName: string
  block: ToolCallBlock
  cwd?: string | undefined
  home?: string | undefined
  openFile: (path: string) => void
  inspect?: (() => void) | undefined
  openArtifact?: ((artifactId: string) => void) | undefined
}

export function ChartPreviewRow(props: ChartPreviewRowProps): React.JSX.Element {
  const view: unknown = 'resultView' in props.block ? props.block.resultView : null
  const card = isChartCard(view) ? view : null
  if (!card) {
    return (
      <div className="chart-preview-row chart-preview-row--pending" data-testid="chart-preview-row-pending" data-call-id={props.callId}>
        <span>等待产物…</span>
      </div>
    )
  }
  return (
    <button type="button" className="chart-preview-row" data-testid="chart-preview-row" data-call-id={props.callId} data-artifact-id={card.artifactId}
      onClick={() => { props.openArtifact?.(card.artifactId) }}>
      <header className="chart-preview-row__header">
        <span className="chart-preview-row__title">{card.title ?? props.toolName}</span>
        <span className="chart-preview-row__meta">
          <span className={`chart-preview-row__generator chart-preview-row__generator--${card.generator}`}>
            {card.generator === 'mermaid' ? 'mermaid' : 'svg'}
          </span>
          <span>{formatBytes(card.bytes)} · {card.mediaType}</span>
        </span>
      </header>
      <span className="chart-preview-row__action">点击预览 →</span>
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
