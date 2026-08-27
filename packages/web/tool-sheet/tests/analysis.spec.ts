import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { apply, renderSheetHtml } from '../src/index.ts'

const ref = {
  attachmentId: `sha256:${'b'.repeat(64)}`,
  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: 1,
  name: 'sales.xlsx',
  kind: 'xlsx',
  summary: 'sales',
} as DocumentAttachmentRef
const xlsx = zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'xl/sharedStrings.xml': strToU8('<sst><si><t>地区</t></si><si><t>销售额</t></si><si><t>华东</t></si><si><t>华南</t></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120</v></c></row><row><c r="A3" t="s"><v>3</v></c><c r="B3"><v>80</v></c></row></sheetData></worksheet>'),
})

function setup() {
  const tools = new Map<string, ReturnType<ToolRuntime['get']>>()
  const writes: Array<{ data: Uint8Array; sessionId: string }> = []
  const ctx = {
    attachments: { readDocument: async () => ({ ref, data: xlsx }) },
    artifactRegistry: { write: async (input: { data: Uint8Array; sessionId: string }) => { writes.push(input); return { artifactId: 'artifact-a', kind: 'sheet', source: 'tool-sheet', mediaType: 'text/html', bytes: input.data.byteLength, createdAt: 'now', sessionId: input.sessionId, title: 'Sales' } } },
    systemPrompt: { section: () => undefined },
    tools: { register: (definition: ReturnType<ToolRuntime['get']>) => { if (definition !== undefined) tools.set(definition.name, definition) } },
  } as never
  apply(ctx, { maxBytes: 1024 * 1024, defaultTitle: 'Spreadsheet' })
  return { tool: tools.get('sheet_analyze')!, writes }
}

const execution = (files: readonly DocumentAttachmentRef[]): ToolRunContext => ({ callId: 'call' as never, name: 'sheet_analyze', arguments: {}, signal: new AbortController().signal, agent: { session: { id: 'session-a', events: [{ data: { source: { files } } }] } } } as never)

describe('sheet analysis page', () => {
  it('renders safe bar and pie SVG from numeric data', () => {
    const html = renderSheetHtml({ title: '<Sales>', columns: [{ key: 'region' }, { key: 'sales', kind: 'number' }], rows: [{ region: '<East>', sales: 12 }] })
    expect(html).toContain('aria-label="bar chart"')
    expect(html).toContain('aria-label="pie chart"')
    expect(html).toContain('&lt;East&gt;: 12')
    expect(html).not.toContain('<East>')
  })

  it('creates a session-owned analysis artifact from an owned XLSX', async () => {
    const { tool, writes } = setup()
    await tool.execute({ attachmentId: ref.attachmentId }, execution([ref]))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.sessionId).toBe('session-a')
    const html = new TextDecoder().decode(writes[0]?.data)
    expect(html).toContain('华东')
    expect(html).toContain('柱状图')
    expect(html).toContain('饼图')
  })

  it('rejects an unowned workbook before reading or writing it', async () => {
    const { tool, writes } = setup()
    await expect(tool.execute({ attachmentId: ref.attachmentId }, execution([]))).rejects.toThrow('not owned')
    expect(writes).toHaveLength(0)
  })
})
