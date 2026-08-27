/**
 * Function plugin that registers the `mermaid_build` / `svg_build` keyed
 * toolview slots. Same pattern as `html-preview-toolview` /
 * `doc-preview-toolview` — the renderer (DocumentPreview) already handles
 * both `image/svg+xml` (inline + sanitized) and `text/html` (iframe srcDoc);
 * the row only owns the `card: 'chart'` discriminator + the generator badge.
 */
import type { Context } from '@deepseek-ai/cordis'
import { ChartPreviewRow } from './ChartPreviewRow'

export const name = 'xiaowei-chart-preview-toolview'

export const inject = ['slots']

export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: unknown }).slots as {
    inject: (slot: string, factory: () => Iterable<unknown>) => void
    register: (options: { name: string; key: string }, component: unknown) => () => void
  }
  slots.inject('tool.call.toolview', function* () {
    yield slots.register({ name: 'tool.call.toolview', key: 'mermaid_build' }, ChartPreviewRow)
    yield slots.register({ name: 'tool.call.toolview', key: 'svg_build' }, ChartPreviewRow)
  })
}
