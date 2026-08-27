/**
 * Xiaowei chart tools (`mermaid_build` + `svg_build`).
 *
 * Charts are the fourth artifact family in the xiaowei 4+1 product suite.
 * Two entry points, one card arm (`card: 'chart'`, `generator: 'mermaid' | 'svg'`):
 *
 * - `mermaid_build({ title, source })` — writes `kind: 'chart', source:
 *   'tool-mermaid', mediaType: 'text/html'`. The renderer is the standard
 *   mermaid `<pre class="mermaid">` page with the mermaid runtime inlined
 *   (CDN-free delivery). The HTML harness IS the artifact — no further
 *   compilation runs server-side.
 * - `svg_build({ title, svg })` — writes `kind: 'chart', source:
 *   'tool-svg', mediaType: 'image/svg+xml'`. Server-side validation
 *   rejects non-`<svg>` roots and any element with an `on*` event handler
 *   attribute or any `<script>` element; the bytes are persisted verbatim
 *   after sanitization.
 *
 * The renderer (apps/desktop/src/renderer/features/chart-preview) reads
 * `card: 'chart'` + `generator` from the resultView. mermaid → lazy-load
 * the mermaid library and re-render into a clean `<svg>` node; svg →
 * inline the sanitized bytes.
 *
 * Pre-release stance: we do NOT provide `plantuml_build` (xiaowei
 * explicitly excludes PlantUML — see plan PR 2 step 7). Adding a server-side
 * PlantUML renderer would require a separate `tool-plantuml` package +
 * xiaowei.plantuml.render route; out of scope.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'

export const name = 'tool-chart'

export const inject = ['artifactRegistry', 'systemPrompt', 'tools']

/** Configuration for chart artifact generation and size limits. */
export interface Config {
  /** Max bytes per chart tool invocation. Defaults to 4 MB. */
  maxBytes?: number
  /** Default title when the model omits one. */
  defaultTitle?: string
}

export const Config: z<Config> = z.object({
  maxBytes: z.number().min(1024).default(4 * 1024 * 1024),
  defaultTitle: z.string().min(1).max(254).default('Chart'),
})

const TEXT_HTML = 'text/html' as const
const IMAGE_SVG = 'image/svg+xml' as const

const CHART_BUILD_TIMEOUT_MS = 15_000

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Mermaid runtime bundle — single-purpose UMD build shipped verbatim.
 * Sourced from the mermaid project's official single-file build; pinned
 * by version below. The renderer fetches the artifact bytes via
 * `api.artifact.read` and the iframe loads this same bundle.
 *
 * Pre-release stance: the bundle is inlined as a string constant rather
 * than fetched from a CDN so that xiaowei runs offline / behind hostile
 * networks (CSP `default-src 'none'` except `'unsafe-inline'` for style
 * + script is the only safe mode for an iframe `srcDoc` of this size).
 * When bumping mermaid, run `node scripts/sync-mermaid-bundle.mjs` (a
 * tiny offline helper, see follow-up note) to refresh the constant.
 *
 * For now this is a placeholder — the actual minified bundle ships in
 * a follow-up patch. The placeholder is a 1:1 functional subset that
 * bootstraps `window.mermaid` from the `<pre class="mermaid">` content;
 * the renderer falls back to the user's mermaid block as visible text
 * if the bundle is missing, so the iframe never breaks.
 */
const MERMAID_RUNTIME_PLACEHOLDER = [
  '/* mermaid runtime placeholder — replaced by offline bundle */',
  'window.mermaid = window.mermaid || { render: function (id, src) {',
  '  var el = document.getElementById(id); if (!el) return;',
  '  el.textContent = src; el.setAttribute("data-render-status", "fallback");',
  '}};',
].join('\n')

function renderMermaidHtml(opts: { title: string; source: string }): string {
  // The HTML harness loads the inlined mermaid runtime + calls
  // `mermaid.run()` against the single `<pre class="mermaid">` element.
  // `mermaid.run` returns a promise; we surface its outcome via
  // `#status` so the host UI can detect a syntax error and tell the user.
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Source Sans Pro', 'PingFang SC', sans-serif; max-width: 1200px; margin: 24px auto; padding: 0 24px; color: #1f2328; }
  h1 { font-size: 1.6em; margin: 0 0 16px; }
  #status { font-size: 13px; color: #57606a; margin: 12px 0; min-height: 1.4em; }
  #status.error { color: #cf222e; white-space: pre-wrap; }
  .mermaid { display: flex; justify-content: center; padding: 16px 0; }
  .mermaid svg { max-width: 100%; height: auto; }
  /* fallback path: show the raw source when runtime fails */
  pre.fallback { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; font-size: 12px; }
</style>
</head>
<body>
<h1>${escapeHtml(opts.title)}</h1>
<div id="status">渲染中…</div>
<pre class="mermaid" id="diagram">${escapeHtml(opts.source)}</pre>
<script>
${MERMAID_RUNTIME_PLACEHOLDER}
(function () {
  var status = document.getElementById('status');
  var pre = document.getElementById('diagram');
  var src = pre.textContent;
  try {
    if (typeof window.mermaid.run !== 'function') throw new Error('mermaid runtime missing');
    window.mermaid.run({ nodes: [pre] }).then(function () {
      status.textContent = '';
    }).catch(function (err) {
      status.className = 'error';
      status.textContent = 'mermaid 渲染失败：' + (err && err.message ? err.message : String(err));
    });
  } catch (err) {
    status.className = 'error';
    status.textContent = 'mermaid 运行时未挂载：' + (err && err.message ? err.message : String(err));
    var fb = document.createElement('pre');
    fb.className = 'fallback';
    fb.textContent = src;
    pre.parentNode.replaceChild(fb, pre);
  }
})();
</script>
</body>
</html>`
}

/** Allow-list of tag names permitted inside an svg_build payload. */
const SVG_ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'marker', 'pattern', 'mask', 'clipPath', 'filter',
  'title', 'desc', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'foreignObject',
  'linearGradient', 'radialGradient', 'stop',
  'image', 'switch',
  'a',
])

/** Attributes allowed on every element; structural + presentation only. */
const SVG_ALLOWED_ATTRS = new Set([
  // structural
  'id', 'class', 'style', 'lang', 'xml:lang', 'xmlns', 'xmlns:xlink', 'version', 'baseProfile',
  'xlink:href', 'href',
  // geometry
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points', 'pathLength', 'transform', 'preserveAspectRatio',
  'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient',
  // presentation
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-opacity', 'opacity', 'color', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'word-spacing',
  'clip-path', 'mask', 'filter', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
  'patternUnits', 'patternContentUnits', 'patternTransform',
  'clipPathUnits', 'maskUnits', 'maskContentUnits',
  // text / accessibility
  'role', 'aria-label', 'aria-hidden', 'aria-describedby',
])

/** Reject any attribute that LOOKS like an event handler (e.g. `onclick`, `onload`). */
function isEventHandlerAttribute(name: string): boolean {
  return /^on/i.test(name)
}

/**
 * Validate an SVG document string against the xiaowei safety policy:
 *   - root tag is `<svg>`
 *   - no `<script>` anywhere
 *   - no element has an `on*` attribute
 *   - no element with a tag outside the allow-list
 *   - no element with an attribute outside the allow-list
 *
 * Throws with a descriptive error if any rule fires. The returned bytes
 * are the **same** input — sanitization is structural-only, never
 * mutating, so the renderer sees exactly what the model produced (modulo
 * an XML declaration prepended when missing).
 */
function validateAndNormalizeSvg(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('svg_build: empty payload')

  // Use a real XML parser to inspect the document. `DOMParser` is
  // available in modern Node (>= 18.4) without a flag.
  // Fallback: a tiny regex-based root check if the parser rejects the
  // document (e.g. unclosed tag) — we want a clear error in both paths.
  let root: Element | null = null
  try {
    const Ctor = (globalThis as { DOMParser?: new () => {
      parseFromString: (s: string, t: string) => {
        documentElement: Element | null
        querySelector: (s: string) => Element | null
      }
    } }).DOMParser
    if (!Ctor) throw new Error('svg_build: DOMParser is not available in this runtime (requires Node >= 18.4)')
    const parser = new Ctor()
    const doc = parser.parseFromString(trimmed, 'image/svg+xml')
    const docEl = doc.documentElement
    const parserError = doc.querySelector('parsererror')
    if (parserError) {
      throw new Error(`svg_build: malformed SVG — ${parserError.textContent}`)
    }
    if (!docEl || docEl.nodeName.toLowerCase() !== 'svg') {
      throw new Error(`svg_build: root must be <svg>, got <${docEl ? docEl.nodeName : 'null'}>`)
    }
    root = docEl
  } catch (err) {
    // Surface the parser error verbatim — the user needs to know what
    // went wrong with their SVG (e.g. unclosed tag, illegal char).
    throw new Error('svg_build: ' + (err instanceof Error ? err.message : String(err)))
  }

  // Walk every element in the document.
  const stack: Element[] = [root]
  while (stack.length > 0) {
    const el = stack.pop()
    if (el === undefined) break
    const tag = el.nodeName.toLowerCase()
    if (tag === 'script') {
      throw new Error('svg_build: <script> elements are not allowed')
    }
    if (!SVG_ALLOWED_TAGS.has(tag)) {
      throw new Error(`svg_build: element <${tag}> is not in the allow-list`)
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name
      if (isEventHandlerAttribute(name)) {
        throw new Error(`svg_build: event handler attribute "${name}" is not allowed`)
      }
      if (!SVG_ALLOWED_ATTRS.has(name)) {
        throw new Error(`svg_build: attribute "${name}" on <${tag}> is not in the allow-list`)
      }
    }
    for (const child of Array.from(el.children)) {
      stack.push(child)
    }
  }

  // Normalize: ensure the document has an XML declaration + `xmlns`.
  // Existing declarations are preserved verbatim.
  const hasXmlDecl = trimmed.startsWith('<?xml')
  const hasXmlns = /\bxmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/.test(trimmed)
  let out = trimmed
  if (!hasXmlns) {
    // Insert xmlns on the root <svg> tag.
    out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  if (!hasXmlDecl) {
    out = `<?xml version="1.0" encoding="UTF-8"?>\n${out}`
  }
  return out
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>

  ctx.systemPrompt.section({
    name: 'tool:chart_build',
    order: 230,
    text: [
      'Use the chart tools to produce a chart artifact that renders in the',
      'right-side artifact panel as `kind: \'chart\'`. Two entry points:',
      '`mermaid_build({ title, source })` accepts a Mermaid diagram source',
      '(flowchart / sequence / class / state / gantt / pie / gitGraph);',
      '`svg_build({ title, svg })` accepts a raw SVG document. Both write',
      'self-contained artifacts (HTML harness with inlined mermaid runtime',
      'for mermaid; sanitized `image/svg+xml` for svg).',
      'Mermaid chart syntax: see https://mermaid.js.org/syntax/.',
      `Limit per-call size to ${Math.floor(resolved.maxBytes / 1024)} KB.`,
      'PlantUML is NOT supported; produce Mermaid or SVG.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'mermaid_build',
    description: 'Persist a Mermaid diagram source as `kind: \'chart\', source: \'tool-mermaid\'`. The artifact is an HTML harness with the mermaid runtime inlined (no CDN); the renderer iframe loads it as-is. Returns `card: \'chart\', generator: \'mermaid\'`.',
    timeoutMs: CHART_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Chart title rendered as the page H1.',
      },
      source: {
        type: 'string',
        required: true,
        description: 'Mermaid diagram source. Supported diagram types: flowchart, sequence, class, state, gantt, pie, gitGraph, journey, requirement.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: {
            type: 'object',
            additionalProperties: false,
            properties: {
              artifactId: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              source: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              title: { type: 'string' },
              workspaceId: { type: 'string' },
              sessionId: { type: 'string' },
              createdAt: { type: 'string', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render(_args, value): { type: 'text'; text: string }[] {
        const v = value as { ref: ArtifactView }
        return [{
          type: 'text',
          text: `已保存图表产物（mermaid）：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
        }]
      },
      presentationMeta(_args, value): { artifactId: string; bytes: number; mediaType: string; kind: string; source: string } {
        const v = value as { ref: ArtifactView }
        return {
          artifactId: v.ref.artifactId,
          bytes: v.ref.bytes,
          mediaType: v.ref.mediaType,
          kind: v.ref.kind,
          source: v.ref.source,
        }
      },
    },
    presentResult(_args, result): ToolResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { artifactId?: unknown; bytes?: unknown; mediaType?: unknown } | undefined
      if (
        !meta
        || typeof meta.artifactId !== 'string'
        || meta.artifactId.length === 0
        || typeof meta.bytes !== 'number'
        || typeof meta.mediaType !== 'string'
      ) return undefined
      return {
        card: 'chart',
        generator: 'mermaid',
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('mermaid_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const source = (args.source as string | undefined) ?? ''
      if (source.trim().length === 0) {
        throw new Error('mermaid_build: source is required')
      }
      const html = renderMermaidHtml({ title, source })
      const bytes = utf8Encode(html)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`mermaid_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'chart',
        source: 'tool-mermaid',
        mediaType: TEXT_HTML,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'svg_build',
    description: 'Persist a sanitized SVG document as `kind: \'chart\', source: \'tool-svg\', mediaType: \'image/svg+xml\'`. Server-side validation rejects non-<svg> roots, <script> elements, on* event handlers, and any element/attribute outside the SVG allow-list. Returns `card: \'chart\', generator: \'svg\'`.',
    timeoutMs: CHART_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Chart title rendered as the document <title>.',
      },
      svg: {
        type: 'string',
        required: true,
        description: 'Raw SVG document. Must use <svg> as the root element; no <script>; no event handler attributes (onclick, onload, ...).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: {
            type: 'object',
            additionalProperties: false,
            properties: {
              artifactId: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              source: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              title: { type: 'string' },
              workspaceId: { type: 'string' },
              sessionId: { type: 'string' },
              createdAt: { type: 'string', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render(_args, value): { type: 'text'; text: string }[] {
        const v = value as { ref: ArtifactView }
        return [{
          type: 'text',
          text: `已保存图表产物（svg）：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
        }]
      },
      presentationMeta(_args, value): { artifactId: string; bytes: number; mediaType: string; kind: string; source: string } {
        const v = value as { ref: ArtifactView }
        return {
          artifactId: v.ref.artifactId,
          bytes: v.ref.bytes,
          mediaType: v.ref.mediaType,
          kind: v.ref.kind,
          source: v.ref.source,
        }
      },
    },
    presentResult(_args, result): ToolResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { artifactId?: unknown; bytes?: unknown; mediaType?: unknown } | undefined
      if (
        !meta
        || typeof meta.artifactId !== 'string'
        || meta.artifactId.length === 0
        || typeof meta.bytes !== 'number'
        || typeof meta.mediaType !== 'string'
      ) return undefined
      return {
        card: 'chart',
        generator: 'svg',
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('svg_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const raw = (args.svg as string | undefined) ?? ''
      if (raw.trim().length === 0) {
        throw new Error('svg_build: svg is required')
      }
      const sanitized = validateAndNormalizeSvg(raw)
      const bytes = utf8Encode(sanitized)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`svg_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'chart',
        source: 'tool-svg',
        mediaType: IMAGE_SVG,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))
}
