/**
 * Xiaowei `read_document` tool.
 *
 * Reads a binary document file from disk (PDF / DOCX / XLSX / TXT / MD) and
 * commits its bytes through `ctx.attachments.saveDocument()` so the durable
 * reference rides the session log. The model receives an
 * `attachmentId` + `mediaType` it can quote back in subsequent turns (a
 * follow-up tool may read the bytes via `ctx.attachments.readDocument`).
 *
 * Why `read_document` instead of `read`? The text `read` tool streams UTF-8
 * line windows; binary document bytes contain NULs and partial UTF-8 sequences
 * that confuse the streaming renderer. Routing through `attachments` keeps
 * binary bytes opaque + content-addressed, and lets the UI preview the
 * document via `DocumentPreview` without the model re-reading it.
 *
 * This tool is only registered when a deployment mounts an `attachments`
 * service that supports document attachments (`attachment-document`).
 * Without that, the tool does not register; `read_image` follows the same
 * pattern. Direct callers from composition code are still safe — the
 * execute body re-checks `attachments.documentLimits.mediaTypes.length`
 * before doing anything irreversible.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

/** Document formats supported by the optional document-attachment provider. */
type DocumentMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'text/plain'
  | 'text/markdown'

/** Provider-neutral durable document reference used by this optional tool. */
interface DocumentAttachmentRef {
  attachmentId: string
  mediaType: DocumentMediaType
  bytes: number
  name?: string
}

interface DocumentAttachmentService {
  documentLimits: {
    maxDocumentBytes: number
    mediaTypes: readonly DocumentMediaType[]
  }
  saveDocument(input: {
    data: Uint8Array
    mediaType: DocumentMediaType
    name?: string
  }): Promise<DocumentAttachmentRef>
}

const READ_DOCUMENT_TIMEOUT_MS = 30_000

/** Hard upper bound: refuse anything bigger, even if deployment config allows it. */
const HARD_MAX_BYTES = 64 * 1024 * 1024

const EXT_TO_MIME: Record<string, DocumentMediaType> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
}

/** Detect declared MIME by file extension. Fallback is undefined; caller surfaces the error. */
function detectMediaType(filePath: string): DocumentMediaType | undefined {
  const lower = filePath.toLowerCase()
  for (const ext of Object.keys(EXT_TO_MIME)) {
    if (lower.endsWith(ext)) return EXT_TO_MIME[ext]
  }
  return undefined
}

/** Magic-byte sniff for declared MIME. Returns null on mismatch (caller throws). */
function sniffSignature(bytes: Uint8Array, declared: DocumentMediaType): boolean {
  if (bytes.byteLength < 4) return false
  // PDF: "%PDF-" = 0x25 0x50 0x44 0x46 0x2D
  if (declared === 'application/pdf') {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  }
  // DOCX/XLSX: ZIP local-file header = 0x50 0x4B 0x03 0x04 (PK\003\004)
  if (declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || declared === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04
  }
  // The remaining declared types are text/plain and text/markdown.
  const cap = Math.min(512, bytes.byteLength)
  for (let i = 0; i < cap; i += 1) {
    if (bytes[i] === 0x00) return false
  }
  return true
}

function readFilenameOnly(filePath: string): string {
  // Strip directory prefix; keep the basename.
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx >= 0 ? filePath.slice(idx + 1) : filePath
}

/**
 * Register the optional binary-document reader when the attachment service is available.
 * @param ctx Cordis plugin context.
 */
export function applyReadDocumentTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:read_document',
    order: 110,
    text: [
      'Use the read_document tool to load a binary document (PDF / DOCX / XLSX',
      '/ TXT / MD) from the filesystem. The tool persists bytes via',
      'ctx.attachments.saveDocument and returns an attachment reference — the',
      'bytes do not stream into the model context. Use read for UTF-8 text',
      'files; do not use read_document for code or markdown sources.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'read_document',
    description: 'Read a binary document (PDF / DOCX / XLSX / TXT / MD) and commit it to the attachment registry. Returns an attachment reference the model can quote; bytes are NOT streamed into the model context.',
    timeoutMs: READ_DOCUMENT_TIMEOUT_MS,
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the document. MIME is inferred from the file extension; magic-byte mismatch rejects.',
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
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          path: { type: 'string', required: true },
        },
      },
      render(_args, value): { type: 'text'; text: string }[] {
        const r = value as { ref: DocumentAttachmentRef; path: string }
        return [{
          type: 'text',
          text: `已读取文档：${r.path}（${r.ref.mediaType}, ${r.ref.bytes} bytes, attachmentId=${r.ref.attachmentId}）`,
        }]
      },
      presentationMeta(_args, value): { attachmentId: string; mediaType: string; bytes: number; path: string } {
        const r = value as { ref: DocumentAttachmentRef; path: string }
        return {
          attachmentId: r.ref.attachmentId,
          mediaType: r.ref.mediaType,
          bytes: r.ref.bytes,
          path: r.path,
        }
      },
    },
    presentResult(_args, result): ToolResultView | undefined {
      // Document attachments ride the attachment card path; no chart-style
      // artifact card. The model-facing text already names the document by
      // path + attachment id, so the generic-card fallback is sufficient.
      void result
      return undefined
    },
    async execute(args, exec) {
      const filePath = ((args.file_path as string | undefined) ?? '').trim()
      if (filePath.length === 0) throw new Error('read_document: file_path is required')

      // Detect MIME by extension first; reject if the deployment doesn't allow it.
      const detected = detectMediaType(filePath)
      if (detected === undefined) {
        throw new Error(
          `read_document: cannot infer MIME for "${filePath}"; supported extensions: .pdf, .docx, .xlsx, .txt, .md`,
        )
      }
      const attachments = ctx.attachments as unknown as Partial<DocumentAttachmentService>
      const limits = attachments.documentLimits
      if (limits === undefined || typeof attachments.saveDocument !== 'function') {
        throw new Error('read_document: no document attachment service is mounted')
      }
      if (!limits.mediaTypes.includes(detected)) {
        throw new Error(`read_document: media type "${detected}" is not allowed by this deployment`)
      }

      // Resolve the file target via the filesystem seam (handles sandboxing).
      const target: FsTarget = await ctx.fs.resolve(filePath, { signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        throw new Error(`read_document: "${filePath}" does not exist`)
      }
      if (info.type === 'directory') {
        throw new Error(`read_document: "${filePath}" is a directory; expected a file`)
      }
      if (info.size !== undefined && info.size > limits.maxDocumentBytes) {
        throw new Error(`read_document: file is ${info.size} bytes, exceeds limit ${limits.maxDocumentBytes}`)
      }

      // Pick the smaller of deployment cap and hard cap.
      const maxBytes = Math.min(limits.maxDocumentBytes, HARD_MAX_BYTES)
      const bytes = await ctx.fs.readBytes(target, exec.signal, maxBytes)
      if (bytes.byteLength > HARD_MAX_BYTES) {
        throw new Error(`read_document: payload is ${bytes.byteLength} bytes, exceeds hard cap ${HARD_MAX_BYTES}`)
      }
      if (!sniffSignature(bytes, detected)) {
        throw new Error(`read_document: magic-byte mismatch — declared ${detected} but bytes do not match`)
      }
      const ref = await attachments.saveDocument({
        data: bytes,
        mediaType: detected,
        name: readFilenameOnly(filePath),
      })
      return { ref, path: target.displayPath }
    },
  }))
}
