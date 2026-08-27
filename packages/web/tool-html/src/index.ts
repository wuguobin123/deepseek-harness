/**
 * Xiaowei `html_build` tool.
 *
 * Single-file HTML delivery for the xiaowei 4+1 product suite. The tool
 * validates the bytes, calls `ctx.artifactRegistry.write({ kind: 'html',
 * source: 'tool-html', mediaType: 'text/html', ... })`, and returns the
 * durable `ArtifactView` so the renderer can read the bytes back through
 * `DocumentPreview` (`apps/desktop/src/renderer/features/document-preview/`).
 *
 * No CDN / no external assets: the model is expected to inline every
 * `<style>` / `<script>` / image (data URI). The renderer's iframe uses
 * `srcDoc` so cross-origin resources simply won't load — `html_build` is
 * the only blessed HTML output path and the model gets feedback in the
 * system prompt when assets fail to resolve.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'

export const name = 'tool-html'

export const inject = ['artifactRegistry', 'systemPrompt', 'tools']

/** Configuration for HTML artifact generation and size limits. */
export interface Config {
  /** Max bytes per html_build invocation. Defaults to 2 MB. */
  maxBytes?: number
  /** Default title when the model omits one. */
  defaultTitle?: string
}

export const Config: z<Config> = z.object({
  maxBytes: z.number().min(1024).default(2 * 1024 * 1024),
  defaultTitle: z.string().min(1).max(254).default('HTML page'),
})

const TEXT_HTML = 'text/html' as const

const HTML_BUILD_TIMEOUT_MS = 15_000

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.systemPrompt.section({
    name: 'tool:html_build',
    order: 220,
    text: [
      'Use the html_build tool when the user wants a self-contained HTML page, a',
      'landing page, a demo, or any single-file deliverable that should render in',
      'the right-side artifact panel. Inline every <style>, <script>, image, and',
      'font as data URIs — the renderer uses an iframe with srcDoc and external',
      'CDN resources will fail to fetch.',
      `The maximum per-call size is ${Math.floor(resolved.maxBytes / 1024)} KB;`,
      'larger pages must be split across multiple html_build calls.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'html_build',
    description: 'Persist a self-contained HTML page to the artifact registry. The renderer previews it in an iframe with `srcDoc`. Inline every asset as a data URI; the iframe cannot fetch external resources.',
    timeoutMs: HTML_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Optional human-readable title; falls back to the configured default when omitted.',
      },
      html: {
        type: 'string',
        required: true,
        description: 'The full HTML body, including <!doctype html>, <head>, and <body>.',
      },
      metadata: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional structured metadata the model can attach (theme tokens, version, etc.). Persisted alongside the artifact.',
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
          text: `已保存 HTML 产物：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
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
    presentResult(args, result): ToolResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { artifactId?: unknown; bytes?: unknown; mediaType?: unknown } | undefined
      if (
        !meta
        || typeof meta.artifactId !== 'string'
        || meta.artifactId.length === 0
        || typeof meta.bytes !== 'number'
        || typeof meta.mediaType !== 'string'
      ) return undefined
      const requestedTitle = ((args.title) ?? '').trim() || resolved.defaultTitle
      return {
        card: 'html',
        ...(requestedTitle !== resolved.defaultTitle ? { title: requestedTitle } : {}),
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('html_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const html = args.html
      if (html.trim().length === 0) {
        throw new Error('html_build: html body must be non-empty')
      }
      const bytes = utf8Encode(html)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`html_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'html',
        source: 'tool-html',
        mediaType: TEXT_HTML,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))
}
