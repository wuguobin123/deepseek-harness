/**
 * Xiaowei `sheet_build` tool.
 *
 * Spreadsheet delivery for the xiaowei 4+1 product suite. The tool takes
 * structured tabular data (column definitions + row arrays) and renders a
 * self-contained semantic HTML table. Bytes are persisted as `kind: 'sheet'`
 * to `ctx.artifactRegistry` and previewed through the shared
 * `DocumentPreview` iframe `srcDoc` path.
 *
 * Pre-release stance: we do NOT provide `.xlsx` / Google Sheets export.
 * The rendered HTML table IS the source of truth. A separate
 * `doc_export_pdf` tool can later wrap a sheet artifact for print; for now
 * `sheet_build` is the preview path.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'
import type { DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { DEFAULT_DOCUMENT_LIMITS, readSpreadsheet } from '@deepseek-ai/dsh-document'

export const name = 'tool-sheet'

export const inject = ['artifactRegistry', 'attachments', 'systemPrompt', 'tools']

/** One semantic column rendered in the table and considered for chart inference. */
export interface SheetColumn {
  /** Column header label. */
  key: string
  /** Optional human-readable label; falls back to `key`. */
  label?: string
  /** Optional kind hint for right-aligning numeric columns. */
  kind?: 'text' | 'number' | 'currency' | 'percent' | 'date'
}

/** Sheet artifact size and title defaults. */
export interface Config {
  /** Max bytes per sheet_build invocation. Defaults to 4 MB. */
  maxBytes?: number
  /** Default title when the model omits one. */
  defaultTitle?: string
}

export const Config: z<Config> = z.object({
  maxBytes: z.number().min(1024).default(4 * 1024 * 1024),
  defaultTitle: z.string().min(1).max(254).default('Spreadsheet'),
})

const TEXT_HTML = 'text/html' as const

const SHEET_BUILD_TIMEOUT_MS = 15_000

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

function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

function renderCell(value: unknown, kind: SheetColumn['kind']): string {
  if (value === null || value === undefined) return ''
  const raw = cellText(value)
  if (kind === 'currency' && typeof value === 'number') {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value)
  }
  if (kind === 'percent' && typeof value === 'number') {
    return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(value)
  }
  if (kind === 'date') {
    // ISO date or epoch ms — both common.
    const ms = typeof value === 'number' ? value : Date.parse(cellText(value))
    if (Number.isFinite(ms)) {
      return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short' }).format(new Date(ms))
    }
  }
  return escapeHtml(raw)
}

/**
 * Render a self-contained table with bar and pie SVG summaries for the first numeric column.
 * @param opts - title, semantic columns, row records, and optional note.
 * @returns complete script-free HTML for sandboxed artifact rendering.
 */
export function renderSheetHtml(opts: {
  title: string
  columns: SheetColumn[]
  rows: Array<Record<string, unknown>>
  note?: string
}): string {
  const numericColumn = opts.columns.find(c => c.kind === 'number' || c.kind === 'currency' || c.kind === 'percent')
  const categoryColumn = opts.columns.find(column => column !== numericColumn) ?? opts.columns[0]
  const chartRows = numericColumn === undefined ? [] : opts.rows
    .map(row => ({
      category: cellText(row[categoryColumn?.key ?? ''] ?? ''),
      value: Number(row[numericColumn.key]),
    }))
    .filter(item => Number.isFinite(item.value) && item.value >= 0)
    .slice(0, 20)
  const numeric = chartRows.map(item => item.value)
  const max = Math.max(1, ...numeric)
  const bar = chartRows.map((item, index) => `<rect x="${index * 22}" y="${100 - item.value / max * 90}" width="15" height="${item.value / max * 90}"><title>${escapeHtml(item.category)}: ${item.value}</title></rect>`).join('')
  const total = numeric.reduce((a, b) => a + Math.max(0, b), 0) || 1
  let angle = 0
  const pie = chartRows.map((item, index) => { const next = angle + item.value / total * Math.PI * 2; const large = next - angle > Math.PI ? 1 : 0; const point = (a: number) => `${50 + 40 * Math.cos(a)} ${50 + 40 * Math.sin(a)}`; const d = `M 50 50 L ${point(angle)} A 40 40 0 ${large} 1 ${point(next)} Z`; angle = next; return `<path d="${d}" fill="hsl(${index * 47} 65% 55%)"><title>${escapeHtml(item.category)}: ${item.value}</title></path>` }).join('')
  const charts = chartRows.length === 0 ? '' : `<section class="sheet-charts"><figure><figcaption>柱状图</figcaption><svg viewBox="0 0 ${Math.max(220, numeric.length * 22)} 110" role="img" aria-label="bar chart">${bar}</svg></figure><figure><figcaption>饼图</figcaption><svg viewBox="0 0 100 100" role="img" aria-label="pie chart">${pie}</svg></figure></section>`
  const head = opts.columns.map(c => `<th class="sheet-th sheet-th--${escapeHtml(c.kind ?? 'text')}">${escapeHtml(c.label ?? c.key)}</th>`).join('')
  const body = opts.rows.map((row) => {
    const cells = opts.columns.map((c) => {
      const text = renderCell(row[c.key], c.kind)
      return `<td class="sheet-td sheet-td--${escapeHtml(c.kind ?? 'text')}">${text}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('\n')
  const noteHtml = opts.note ? `<p class="sheet-note">${escapeHtml(opts.note)}</p>` : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Source Sans Pro', 'PingFang SC', sans-serif; max-width: 1100px; margin: 32px auto; padding: 0 24px; color: #1f2328; }
  h1 { font-size: 1.6em; margin: 0 0 16px; }
  .sheet-table-wrap { overflow-x: auto; border: 1px solid #e6e8eb; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border-bottom: 1px solid #f0f1f3; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; position: sticky; top: 0; }
  .sheet-th--number, .sheet-th--currency, .sheet-th--percent { text-align: right; font-variant-numeric: tabular-nums; }
  .sheet-td--number, .sheet-td--currency, .sheet-td--percent { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #fafbfc; }
  .sheet-note { margin-top: 16px; color: #57606a; font-size: 13px; }
  .sheet-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 24px 0; }
  .sheet-charts figure { margin: 0; padding: 16px; border: 1px solid #e6e8eb; border-radius: 8px; }
  .sheet-charts figcaption { margin-bottom: 12px; font-weight: 600; }
  .sheet-charts svg { width: 100%; max-height: 280px; }
  .sheet-charts rect { fill: #4f7cff; }
</style>
</head>
<body>
<h1>${escapeHtml(opts.title)}</h1>
<div class="sheet-table-wrap">
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>
${charts}
${noteHtml}
</body>
</html>`
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  ctx.systemPrompt.section({
    name: 'tool:sheet_build',
    order: 223,
    text: [
      'Use the sheet_build tool to produce a self-contained HTML table that',
      'renders in the right-side artifact panel as `kind: \'sheet\'`. The bytes',
      'are semantic HTML — every <style> is inlined, there is no external asset.',
      'Shape: columns = [{ key, label?, kind? }]; rows = [{ [key]: value }].',
      '`kind` is one of text | number | currency | percent | date and controls',
      'right-alignment + formatting; numeric formatting uses Intl.NumberFormat',
      `with locale 'zh-CN'. Limit per-call size to ${Math.floor(resolved.maxBytes / 1024)} KB.`,
    ].join(' '),
  })
  ctx.systemPrompt.section({
    name: 'tool:sheet_analyze',
    order: 222,
    text: 'When the user uploads an XLSX file and asks for analysis or visualization, call sheet_analyze with its attachmentId. The tool reads only a file owned by the current session and creates a right-side analysis page with a table, bar chart, and pie chart.',
  })

  ctx.tools.register(defineTool({
    name: 'sheet_analyze',
    description: 'Create a persisted HTML data-analysis page with a table, bar chart, and pie chart from an XLSX file uploaded in the current session.',
    timeoutMs: SHEET_BUILD_TIMEOUT_MS,
    parameters: {
      attachmentId: { type: 'string', required: true },
      sheetIndex: { type: 'integer', description: 'Zero-based worksheet index; defaults to 0.' },
      title: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const result = value as unknown as { ref: ArtifactView; sheetName: string; rows: number }
        return [{ type: 'text', text: `已生成 Excel 分析页面：${result.ref.title ?? result.sheetName}（${result.rows} 行，含柱状图和饼图）` }]
      },
      presentationMeta(_args, value) {
        const result = value as unknown as { ref: ArtifactView }
        return {
          artifactId: result.ref.artifactId,
          bytes: result.ref.bytes,
          mediaType: result.ref.mediaType,
          kind: result.ref.kind,
          source: result.ref.source,
        }
      },
    },
    presentResult(_args, result): ToolResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { artifactId?: unknown; bytes?: unknown; mediaType?: unknown } | undefined
      if (typeof meta?.artifactId !== 'string' || typeof meta.bytes !== 'number' || typeof meta.mediaType !== 'string') return undefined
      return { card: 'sheet', artifactId: meta.artifactId, bytes: meta.bytes, mediaType: meta.mediaType }
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('sheet_analyze: current session is required')
      const sessionId = agent.session.id
      const attachmentId = args.attachmentId
      const files = agent.session.events.flatMap((event) => {
        const source = (event.data as { source?: { files?: readonly DocumentAttachmentRef[] } }).source
        return source?.files ?? []
      })
      const ref = files.find(candidate => candidate.attachmentId === attachmentId && candidate.kind === 'xlsx')
      if (ref === undefined) throw new Error('sheet_analyze: XLSX attachment is not owned by the current session')
      const stored = await ctx.attachments.readDocument(ref)
      const workbook = readSpreadsheet(
        stored.data,
        { mediaType: ref.mediaType, ...(ref.name === undefined ? {} : { name: ref.name }) },
        DEFAULT_DOCUMENT_LIMITS,
      )
      const sheetIndex = Math.max(0, Math.floor(args.sheetIndex ?? 0))
      const sheet = workbook.sheets[sheetIndex]
      if (sheet === undefined) throw new Error(`sheet_analyze: worksheet ${sheetIndex} does not exist`)
      const width = Math.max(0, ...sheet.rows.map(row => row.length))
      if (width === 0) throw new Error('sheet_analyze: worksheet has no readable cells')
      const header = sheet.rows[0] ?? []
      const keys = Array.from({ length: width }, (_value, index) => `column_${index + 1}`)
      const columns: SheetColumn[] = keys.map((key, index) => {
        const values = sheet.rows.slice(1).map(row => row[index]).filter(value => value !== null && value !== '')
        return { key, label: String(header[index] ?? `Column ${index + 1}`), kind: values.length > 0 && values.every(value => typeof value === 'number') ? 'number' : 'text' }
      })
      const rows = sheet.rows.slice(1).map(row => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? null])))
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : `${ref.name ?? 'Excel'} · ${sheet.name}`
      const html = renderSheetHtml({ title, columns, rows, note: `源文件：${ref.name ?? ref.attachmentId}` })
      const data = utf8Encode(html)
      if (data.byteLength > resolved.maxBytes) throw new Error(`sheet_analyze: payload is ${data.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      const artifactRef = await ctx.artifactRegistry.write({ data, kind: 'sheet', source: 'tool-sheet', mediaType: TEXT_HTML, sessionId, title, name: `${title}.html` })
      return { ref: artifactRef, sheetName: sheet.name, rows: rows.length } as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sheet_build',
    description: 'Render a self-contained semantic-HTML table (no external assets) and persist it to the artifact registry as `kind: \'sheet\'`. Columns declare key + kind (text/number/currency/percent/date); rows are objects keyed by column key.',
    timeoutMs: SHEET_BUILD_TIMEOUT_MS,
    parameters: {
      title: {
        type: 'string',
        description: 'Spreadsheet title rendered as the page H1.',
      },
      columns: {
        type: 'array',
        required: true,
        description: 'Column definitions in display order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', required: true },
            label: { type: 'string' },
            kind: { type: 'string' },
          },
        },
      },
      rows: {
        type: 'array',
        required: true,
        description: 'Data rows; each is a `{ [column.key]: value }` object.',
        items: { type: 'object', additionalProperties: true },
      },
      note: {
        type: 'string',
        description: 'Optional footnote text rendered below the table.',
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
          text: `已保存表格产物：${v.ref.title ?? v.ref.name ?? v.ref.artifactId} (${v.ref.bytes} bytes, ${v.ref.mediaType})`,
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
        card: 'sheet',
        artifactId: meta.artifactId,
        bytes: meta.bytes,
        mediaType: meta.mediaType,
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('sheet_build: Agent session is required for artifact ownership')
      const title = ((args.title) ?? '').trim() || resolved.defaultTitle
      const columnsIn = (args.columns as SheetColumn[] | undefined) ?? []
      const rowsIn = (args.rows as Array<Record<string, unknown>> | undefined) ?? []
      if (columnsIn.length === 0) {
        throw new Error('sheet_build: at least one column is required')
      }
      const html = renderSheetHtml({
        title,
        columns: columnsIn,
        rows: rowsIn,
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
      })
      const bytes = utf8Encode(html)
      if (bytes.byteLength > resolved.maxBytes) {
        throw new Error(`sheet_build: payload is ${bytes.byteLength} bytes, exceeds limit ${resolved.maxBytes}`)
      }
      const ref = await ctx.artifactRegistry.write({
        data: bytes,
        kind: 'sheet',
        source: 'tool-sheet',
        mediaType: TEXT_HTML,
        sessionId,
        title,
        ...(args.title ? { name: args.title } : {}),
      })
      return { ref }
    },
  }))
}
