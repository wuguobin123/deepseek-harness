/**
 * Function plugin that registers the document and sheet artifact toolviews
 * slots. Same pattern as `html-preview-toolview` — the iframe srcDoc is the
 * same surface `DocumentPreview` already owns; the row only adapts the
 * `resultView` arm.
 */
import type { Context } from '@deepseek-ai/cordis'
import { DocPreviewRow } from './DocPreviewRow'

export const name = 'xiaowei-doc-preview-toolview'

export const inject = ['slots']

export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: unknown }).slots as {
    inject: (slot: string, factory: () => Iterable<unknown>) => void
    register: (options: { name: string; key: string }, component: unknown) => () => void
  }
  slots.inject('tool.call.toolview', function* () {
    yield slots.register({ name: 'tool.call.toolview', key: 'doc_build' }, DocPreviewRow)
    yield slots.register({ name: 'tool.call.toolview', key: 'sheet_build' }, DocPreviewRow)
    yield slots.register({ name: 'tool.call.toolview', key: 'sheet_analyze' }, DocPreviewRow)
  })
}
