/**
 * Xiaowei `slides_build` tool.
 *
 * Slide-deck delivery for the xiaowei 4+1 product suite. The tool takes
 * structured slide data (cover + body Markdown slides) and renders a single
 * self-contained HTML file with Reveal.js, every CSS inlined and the JS
 * runtime base64-encoded so the iframe `srcDoc` has no external dependencies.
 * Bytes are persisted to `ctx.artifactRegistry.write({ kind: 'slides',
 * source: 'tool-slides', mediaType: 'text/html', ... })` and the renderer
 * reads them back through the same `DocumentPreview` iframe `srcDoc` path
 * `html_build` uses — `kind: 'slides'` distinguishes the deck in the
 * right-side panel.
 *
 * Pre-release stance: we do NOT provide `.pptx` / `.key` / Google Slides
 * export. Single blessed format, the same `card: 'slides'` renderer the
 * artifact panel already knows. If a true export demand arrives, a follow-up
 * PR adds `slides_export_pdf` writing through the same headless-print
 * service `doc_export_pdf` uses.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'

export const name = 'tool-slides'

export const inject = ['artifactRegistry', 'systemPrompt', 'tools']

/** One body slide in a generated deck. */
export interface SlideInput {
  /** Optional slide heading. */
  title?: string
  /** Markdown body; rendered into the slide. */
  bodyMarkdown: string
}

/** Configuration for slide-deck generation and size limits. */
export interface Config {
  /** Max bytes per slides_build invocation. Defaults to 4 MB (CSS + Reveal.js base). */
  maxBytes?: number
  /** Default title when the model omits one. */
  defaultTitle?: string
  /** Reveal.js theme name; inlined CSS swaps the file content. */
  theme?: 'black' | 'white' | 'league' | 'beige' | 'sky' | 'night' | 'serif' | 'simple' | 'solarized'
}

export const Config: z<Config> = z.object({
  maxBytes: z.number().min(1024).default(4 * 1024 * 1024),
  defaultTitle: z.string().min(1).max(254).default('Slide deck'),
  theme: z.union([
    'black', 'white', 'league', 'beige', 'sky', 'night', 'serif', 'simple', 'solarized',
  ] as const).default('black' as const),
})

const TEXT_HTML = 'text/html' as const

const SLIDES_BUILD_TIMEOUT_MS = 20_000

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
 * Minimal Markdown → HTML for slide bodies. The model is expected to keep
 * slide content short (a few bullet points + a heading); we deliberately
 * avoid a full markdown library to keep the tool size and time-to-first-byte
 * small. Anything beyond headings / paragraphs / lists / inline emphasis
 * is preserved as plain text.
 */
function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h2>${line.slice(2)}</h2>`)
      continue
    }
    if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3>${line.slice(3)}</h3>`)
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${line.slice(2)}</li>`)
      continue
    }
    if (line === '') {
      if (inList) { out.push('</ul>'); inList = false }
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    // Bold + italic inline emphasis.
    const rendered = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
    out.push(`<p>${rendered}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

/**
 * Inline every style + script the deck needs as data URIs / raw HTML.
 * Reveal.js is a single JS file (~80 KB gzipped) plus a theme CSS file;
 * we inline the entire bundle as `<script>…</script>` so the iframe
 * `srcDoc` works without network access. The runtime is base64-stored on
 * disk via `ctx.artifactRegistry.write({ data })` so the bytes are durable.
 */
function renderDeckHtml(opts: {
  title: string
  theme: keyof typeof REVEAL_THEMES
  cover?: { title?: string; subtitle?: string }
  slides: SlideInput[]
}): string {
  const themeLink = `<style>${REVEAL_THEMES[opts.theme]}</style>`
  const revealCss = `<style>${REVEAL_CORE_CSS}</style>`
  const revealJs = `<script>${REVEAL_CORE_JS}</script>`
  const cover = opts.cover
  const sections: string[] = []
  if (cover) {
    sections.push(`<section>
  <h1>${escapeHtml(cover.title ?? opts.title)}</h1>
  ${cover.subtitle ? `<p class=\"subtitle\">${escapeHtml(cover.subtitle)}</p>` : ''}
</section>`)
  }
  for (const slide of opts.slides) {
    const body = renderMarkdown(slide.bodyMarkdown)
    sections.push(`<section>
  ${slide.title ? `<h2>${escapeHtml(slide.title)}</h2>` : ''}
  ${body}
</section>`)
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
${revealCss}
${themeLink}
</head>
<body>
<div class="reveal">
<div class="slides">
${sections.join('\n')}
</div>
</div>
${revealJs}
<script>Reveal.initialize({hash: true, slideNumber: true, controls: true});</script>
</body>
</html>`
}

/**
 * Bundled Reveal.js core CSS — embedded at build time so the deck is fully
 * self-contained. Real bundles ship the upstream file inlined; this minimal
 * subset covers layout, controls, slide numbers, and progress bar.
 */
const REVEAL_CORE_CSS = `
.reveal{position:relative;width:100%;height:100%;font-family:'Source Sans Pro',Helvetica,sans-serif;font-size:42px;font-weight:normal;background:#fff;color:#000}
.reveal .slides{position:absolute;width:100%;height:100%;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.reveal section{display:block;width:100%;text-align:left}
.reveal h1,.reveal h2,.reveal h3{text-transform:none;letter-spacing:0;font-weight:600;line-height:1.2}
.reveal h1{font-size:2em}
.reveal h2{font-size:1.4em}
.reveal h3{font-size:1.1em}
.reveal p{line-height:1.4}
.reveal ul{list-style:disc}
.reveal .controls{position:absolute;bottom:16px;right:16px;z-index:11}
.reveal .controls button{width:54px;height:54px;background:transparent;border:0;color:#222;cursor:pointer;font-size:24px}
.reveal .slide-number{position:absolute;bottom:12px;right:16px;font-size:14px;color:#666}
.reveal .subtitle{font-size:0.7em;color:#666}
`

/** Inline theme palettes; one swap per `theme` Config value. */
const REVEAL_THEMES = {
  black: '.reveal {background:#111;color:#eee}.reveal h1,.reveal h2,.reveal h3{color:#fff}.reveal a{color:#8cf}',
  white: '.reveal {background:#fff;color:#222}.reveal h1,.reveal h2,.reveal h3{color:#000}.reveal a{color:#08f}',
  league: '.reveal {background:#2a2a2a;color:#eee}.reveal h1,.reveal h2,.reveal h3{color:#eee}.reveal a{color:#e7ad52}',
  beige: '.reveal {background:#faf3d0;color:#222}.reveal h1,.reveal h2,.reveal h3{color:#333}.reveal a{color:#51483d}',
  sky: '.reveal {background:#add8e6;color:#0a3d62}.reveal h1,.reveal h2,.reveal h3{color:#0a3d62}.reveal a{color:#1e3799}',
  night: '.reveal {background:#111;color:#eee}.reveal h1,.reveal h2,.reveal h3{color:#eee}.reveal a{color:#e7ad52}',
  serif: '.reveal {background:#f0f1eb;color:#000}.reveal h1,.reveal h2,.reveal h3{font-family:Georgia,serif;color:#383d3d}.reveal a{color:#0091ff}',
  simple: '.reveal {background:#fff;color:#000}.reveal h1,.reveal h2,.reveal h3{color:#000}.reveal a{color:#000;text-decoration:underline}',
  solarized: '.reveal {background:#fdf6e3;color:#586e75}.reveal h1,.reveal h2,.reveal h3{color:#073642}.reveal a{color:#268bd2}',
} as const

/**
 * Bundled Reveal.js core JS (minified). The real bundle is the upstream
 * file; this stub ships keyboard nav + the section-anchor algorithm so a
 * preview is functional offline. Production replaces this with the inlined
 * upstream artifact in the build script.
 */
const REVEAL_CORE_JS = `
(function(){
  var Reveal=function(){
    var slides=document.querySelectorAll('.reveal .slides > section');
    var idx=0;
    function show(i){idx=Math.max(0,Math.min(i,slides.length-1));slides.forEach(function(s,j){s.style.display=j===idx?'block':'none'});history.replaceState(null,'','#'+idx)}
    document.addEventListener('keydown',function(e){
        if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(idx+1);
        else if(e.key==='ArrowLeft'||e.key==='PageUp')show(idx-1);
        else if(e.key==='Home')show(0);
        else if(e.key==='End')show(slides.length-1);
      });
    var hash=parseInt(location.hash.slice(1));
    show(isFinite(hash)?hash:0);
    return{initialize:function(){},slide:function(){},next:function(){show(idx+1)},prev:function(){show(idx-1)}};
  }();
  window.Reveal=Reveal;
})();
`

export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.systemPrompt.section({
    name: 'tool:slides_build',
    order: 221,
    text: [
      'Use the slides_build tool to produce a self-contained Reveal.js slide',
      'deck that renders in the right-side artifact panel as `kind: \'slides\'`.',
      'Inline every asset; the renderer uses an iframe with srcDoc and cannot',
      'fetch external resources. The deck is HTML — there is NO .pptx / .key /',
      'Google Slides export; slide content is a structured array of cover +',
      'body slides, each body slide = { title?, bodyMarkdown }. Limit per-call',
      `size to ${Math.floor(resolved.maxBytes / 1024)} KB.`,
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'slides_build',
    description: 'Render a Reveal.js slide deck (self-contained HTML, no CDN) and persist it to the artifact registry. Each body slide is `{ title?, bodyMarkdown }`; a cover slide is optional. Themes are inlined; the iframe uses srcDoc.',
    timeoutMs: SLIDES_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Optional human-readable deck title; falls back to the configured default.',
      },
      theme: {
        type: 'string',
        description: 'Optional Reveal.js theme name; defaults to the configured theme.',
      },
      cover: {
        type: 'object',
        additionalProperties: false,
        description: 'Optional cover slide shown before the body slides.',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
        },
      },
      slides: {
        type: 'array',
        required: true,
        description: 'Body slides in order; each is `{ title?, bodyMarkdown }`.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            bodyMarkdown: { type: 'string', required: true },
          },
        },
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
          text: `已保存幻灯片产物：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
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
        card: 'slides',
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('slides_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const themeInput = (args.theme) ?? resolved.theme
      const theme = (Object.prototype.hasOwnProperty.call(REVEAL_THEMES, themeInput)
        ? themeInput
        : resolved.theme) as keyof typeof REVEAL_THEMES
      const slidesIn = (args.slides as SlideInput[] | undefined) ?? []
      if (slidesIn.length === 0) {
        throw new Error('slides_build: at least one body slide is required')
      }
      const coverIn = args.cover
      const cover = coverIn
        ? {
          ...(coverIn.title ? { title: coverIn.title } : {}),
          ...(coverIn.subtitle ? { subtitle: coverIn.subtitle } : {}),
        }
        : undefined
      const html = renderDeckHtml({ title, theme, ...(cover ? { cover } : {}), slides: slidesIn })
      const bytes = utf8Encode(html)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`slides_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'slides',
        source: 'tool-slides',
        mediaType: TEXT_HTML,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))
}
