import { describe, expect, it } from 'vitest'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import * as ToolDocument from '../src/index.ts'

const ref = {
  attachmentId: `sha256:${'a'.repeat(64)}`,
  mediaType: 'application/pdf',
  bytes: 35,
  name: 'report.pdf',
  kind: 'pdf',
  summary: 'report',
} as DocumentAttachmentRef
function textPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let source = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = source.length
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(source)
}
const pdf = textPdf('report')

function setup() {
  let tool: ReturnType<ToolRuntime['get']>
  let reads = 0
  const ctx = {
    attachments: { readDocument: async () => { reads += 1; return { ref, data: pdf } } },
    systemPrompt: { section: () => undefined },
    tools: { register: (definition: ReturnType<ToolRuntime['get']>) => { tool = definition } },
  } as never
  ToolDocument.apply(ctx, { maxCharacters: 4_000 })
  if (tool === undefined) throw new Error('document_read was not registered')
  return { tool, reads: () => reads }
}

function execution(files: readonly DocumentAttachmentRef[]): ToolRunContext {
  return { callId: 'call' as never, name: 'document_read', arguments: {}, signal: new AbortController().signal, agent: { session: { id: 'session-a', events: [{ data: { source: { files } } }] } } } as never
}

describe('document_read ownership', () => {
  it('reads a reference recorded by the current session', async () => {
    const { tool, reads } = setup()
    const result = await tool.execute({ attachmentId: ref.attachmentId }, execution([ref]))
    expect(result).toMatchObject({ sessionId: 'session-a', ref: { kind: 'pdf' } })
    expect(reads()).toBe(1)
  })

  it('rejects an unowned reference before storage access', async () => {
    const { tool, reads } = setup()
    await expect(tool.execute({ attachmentId: ref.attachmentId }, execution([]))).rejects.toThrow('not owned')
    expect(reads()).toBe(0)
  })
})
