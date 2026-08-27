/** Model-facing bounded reader for files attached to the current session. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { readDocument, readDocumentCursor, DEFAULT_DOCUMENT_LIMITS } from '@deepseek-ai/dsh-document'

export const name = 'tool-document'
export const inject = ['attachments', 'systemPrompt', 'tools']
/** Configuration for model-facing document extraction. */
export interface Config {
  /** Maximum characters extracted and returned by one document read. */
  maxCharacters?: number
}
export const Config: z<Config> = z.object({ maxCharacters: z.number().min(1000).max(240_000).default(40_000) })

export function apply(ctx: Context, config: Config): void {
  const maxCharacters = config.maxCharacters ?? 40_000
  ctx.systemPrompt.section({ name: 'tool:document_read', order: 224, text: 'Use document_read only for a file attached to the current session. Read one page, slide, worksheet, or a bounded cursor range; formulas, macros, links, embedded files, OCR, and binary legacy Office formats are not executed or interpreted.' })
  ctx.tools.register(defineTool({
    name: 'document_read',
    description: 'Read bounded text from a PDF, DOCX, XLSX, or PPTX uploaded in the current session.',
    timeoutMs: 15_000,
    parameters: { attachmentId: { type: 'string', required: true }, cursor: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer' }, limit: { type: 'integer' } } } },
    output: { schema: { type: 'object', additionalProperties: true }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('document_read: current session is required')
      const sessionId = agent.session.id
      const attachmentId = args.attachmentId
      if (!attachmentId.startsWith('sha256:')) throw new Error('document_read: invalid file reference')
      const eventFiles = agent.session.events.flatMap((event) => {
        const data = event.data as { source?: { files?: readonly DocumentAttachmentRef[] } }
        return data.source?.files ?? []
      })
      const ref = eventFiles.find(candidate => candidate.attachmentId === attachmentId)
      if (ref === undefined) throw new Error('document_read: attachment is not owned by the current session')
      const stored = await ctx.attachments.readDocument(ref)
      const parsed = await readDocument(
        stored.data,
        { mediaType: ref.mediaType, ...(ref.name === undefined ? {} : { name: ref.name }) },
        { ...DEFAULT_DOCUMENT_LIMITS, maxCharacters },
      )
      const rawCursor = args.cursor
      const cursor = rawCursor === undefined
        ? undefined
        : { index: rawCursor.index ?? 0, ...(rawCursor.limit === undefined ? {} : { limit: rawCursor.limit }) }
      const page = readDocumentCursor(parsed, cursor)
      return {
        sessionId,
        ref: parsed.ref,
        summary: parsed.summary.slice(0, maxCharacters),
        items: page.items,
        ...(page.nextCursor === undefined ? {} : {
          nextCursor: {
            index: page.nextCursor.index,
            ...(page.nextCursor.limit === undefined ? {} : { limit: page.nextCursor.limit }),
          },
        }),
      } as unknown as Record<string, JsonValue>
    },
  }))
}
