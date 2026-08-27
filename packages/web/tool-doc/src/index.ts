/**
 * Xiaowei `doc_build` tool.
 *
 * Document delivery for the xiaowei 4+1 product suite. The tool takes
 * structured sections and persists either semantic HTML or Markdown as
 * `kind: 'doc'` to `ctx.artifactRegistry`. HTML renders in the sandboxed
 * iframe; Markdown renders through the semantic document viewer.
 *
 * Pre-release stance: we do NOT provide `.docx` / Google Docs export. The
 * rendered HTML IS the source of truth. A separate `doc_export_pdf` tool
 * (a follow-up PR) runs a headless print service on demand; this build
 * focuses on the preview path.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'

export const name = 'tool-doc'

export const inject = ['artifactRegistry', 'systemPrompt', 'tools']

/** One ordered section in a generated document. */
export interface DocSection {
  /** Optional section heading; rendered as `<h2>`. */
  heading?: string
  /** Markdown-flavored body text. */
  bodyMarkdown: string
}

/** Encoding stored for one generated document. */
export type DocFormat = 'html' | 'markdown'

/** Configuration for document artifact generation and size limits. */
export interface Config {
  /** Max bytes per doc_build invocation. Defaults to 4 MB. */
  maxBytes?: number
  /** Default title when the model omits one. */
  defaultTitle?: string
}

export const Config: z<Config> = z.object({
  maxBytes: z.number().min(1024).default(4 * 1024 * 1024),
  defaultTitle: z.string().min(1).max(254).default('Document'),
})

const TEXT_HTML = 'text/html' as const
const TEXT_MARKDOWN = 'text/markdown' as const

const DOC_BUILD_TIMEOUT_MS = 15_000

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
 * Minimal Markdown → HTML for doc bodies. Same shape as the slides renderer;
 * keeps a small surface (headings + paragraphs + lists + inline emphasis) and
 * falls through plain text for everything else. The model is expected to
 * keep doc content structured enough to render cleanly.
 */
function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h1>${line.slice(2)}</h1>`)
      continue
    }
    if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h2>${line.slice(3)}</h2>`)
      continue
    }
    if (line.startsWith('### ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3>${line.slice(4)}</h3>`)
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
    const rendered = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
    out.push(`<p>${rendered}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function renderDocHtml(opts: { title: string; sections: DocSection[] }): string {
  const body = opts.sections.map((s) => {
    const inner = renderMarkdown(s.bodyMarkdown)
    return s.heading
      ? `<section><h2>${escapeHtml(s.heading)}</h2>${inner}</section>`
      : `<section>${inner}</section>`
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Source Sans Pro', 'PingFang SC', sans-serif; max-width: 760px; margin: 48px auto; padding: 0 24px; color: #1f2328; line-height: 1.6; }
  h1 { font-size: 2.2em; border-bottom: 1px solid #e6e8eb; padding-bottom: 12px; }
  h2 { font-size: 1.5em; margin-top: 1.6em; }
  h3 { font-size: 1.2em; margin-top: 1.4em; }
  p { margin: 0.8em 0; }
  code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; }
  ul { padding-left: 1.4em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e6e8eb; padding: 6px 12px; text-align: left; }
  blockquote { border-left: 3px solid #c8d1d9; margin: 1em 0; padding: 4px 12px; color: #57606a; }
</style>
</head>
<body>
<h1>${escapeHtml(opts.title)}</h1>
${body}
</body>
</html>`
}

/**
 * Serialize structured document input without converting its Markdown body.
 * @param opts Document title and ordered sections.
 * @returns Markdown document text.
 */
export function renderDocMarkdown(opts: { title: string; sections: DocSection[] }): string {
  const sections = opts.sections.map(section => [
    section.heading === undefined ? undefined : `## ${section.heading}`,
    section.bodyMarkdown,
  ].filter((part): part is string => part !== undefined && part.trim() !== '').join('\n\n'))
  return [`# ${opts.title}`, ...sections].filter(part => part.trim() !== '').join('\n\n') + '\n'
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.systemPrompt.section({
    name: 'tool:doc_build',
    order: 222,
    text: [
      'Use the doc_build tool to produce an HTML or Markdown document that',
      'renders in the right-side artifact panel as `kind: \'doc\'`. Choose',
      '`format: \'markdown\'` when the requested deliverable is a Markdown',
      'file; HTML stays self-contained with no external asset. Section shape:',
      'sections = [{ heading?, bodyMarkdown }].',
      `Limit per-call size to ${Math.floor(resolved.maxBytes / 1024)} KB.`,
      'For a printable artifact, plan a separate `doc_export_pdf` call (a',
      'follow-up PR adds the headless-print service); for now `doc_build`',
      'is the preview path.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'doc_build',
    description: 'Persist a semantic HTML or Markdown document to the artifact registry as `kind: \'doc\'`. Body sections use Markdown for headings, paragraphs, lists, emphasis, and code.',
    timeoutMs: DOC_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Document title rendered as the page H1.',
      },
      format: {
        type: 'string',
        enum: ['html', 'markdown'],
        description: 'Stored document format. Defaults to html; use markdown for a Markdown deliverable.',
      },
      sections: {
        type: 'array',
        required: true,
        description: 'Document sections in order; each is `{ heading?, bodyMarkdown }`.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            heading: { type: 'string' },
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
          text: `已保存文档产物：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
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
        card: 'doc',
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('doc_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const format = (args.format) ?? 'html'
      const sectionsIn = (args.sections as DocSection[] | undefined) ?? []
      if (sectionsIn.length === 0) {
        throw new Error('doc_build: at least one section is required')
      }
      const document = format === 'markdown'
        ? renderDocMarkdown({ title, sections: sectionsIn })
        : renderDocHtml({ title, sections: sectionsIn })
      const bytes = utf8Encode(document)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`doc_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'doc',
        source: 'tool-doc',
        mediaType: format === 'markdown' ? TEXT_MARKDOWN : TEXT_HTML,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))
}
