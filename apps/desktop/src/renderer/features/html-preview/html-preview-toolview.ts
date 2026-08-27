/**
 * Function plugin that registers the `html_build` keyed toolview slot.
 *
 * Mirrors `packages/client/ui-tool/src/client/tool/toolviews/web-row.tsx`'s
 * registration pattern: the slot is keyed on the wire tool name; a keyed hit
 * replaces the generic tool row; an unknown key falls back to the generic
 * row. The plugin declares no `default` export (per the cordis function-plugin
 * rule: `name` + `inject` + `apply` are named exports).
 */
import type { Context } from '@deepseek-ai/cordis'
import { HtmlPreviewRow } from './HtmlPreviewRow'

export const name = 'xiaowei-html-preview-toolview'

/** Required services: the slot registry already declared by ui-tool. */
export const inject = ['slots']

/**
 * Register the html_build keyed toolview entry.
 *
 * `ctx.slots.inject('tool.call.toolview', ...)` is the one place the
 * session-scoped keyed slot accepts new cells — `ToolCallTree` (ui-tool's
 * apply) declared `tool.call.toolview` as a child slot and renders cells by
 * dispatching on `key`.
 *
 * @param ctx - renderer context; the slot registry lives at `ctx.slots`.
 */
export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: unknown }).slots as {
    inject: (slot: string, factory: () => Iterable<unknown>) => void
    register: (options: { name: string; key: string }, component: unknown) => () => void
  }
  slots.inject('tool.call.toolview', function* () {
    yield slots.register({ name: 'tool.call.toolview', key: 'html_build' }, HtmlPreviewRow)
    // `slides_build` reuses the same render path (iframe srcDoc); the
    // right-side panel distinguishes by artifact `kind`, not by `card`.
    yield slots.register({ name: 'tool.call.toolview', key: 'slides_build' }, HtmlPreviewRow)
  })
}
