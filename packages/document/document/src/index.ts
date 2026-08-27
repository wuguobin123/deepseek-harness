/** Safe, bounded readers for PDF and modern Office Open XML uploads. */
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'

/** Supported modern document format identifiers. */
export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'pptx'
/** Accepted media types corresponding one-to-one with {@link DocumentKind}. */
export type DocumentMediaType = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
/** Resource limits applied before and during document parsing. */
export interface DocumentLimits {
  maxBytes: number
  maxExpandedBytes: number
  maxCompressionRatio: number
  maxCharacters: number
  maxUnits: number
  maxSpreadsheetRows: number
  maxSpreadsheetColumns: number
  maxArchiveEntries: number
}
/** Conservative parser defaults for interactive document analysis. */
export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxCharacters: 240_000,
  maxUnits: 400,
  maxSpreadsheetRows: 2_000,
  maxSpreadsheetColumns: 100,
  maxArchiveEntries: 5_000,
}
/** Verified metadata derived from complete document bytes. */
export interface DocumentRef { sha256: `sha256:${string}`; kind: DocumentKind; mediaType: DocumentMediaType; bytes: number; name?: string }
/** One bounded page, section, slide, or worksheet text unit. */
export interface DocumentUnit { index: number; label: string; text: string }
/** Verified document metadata, summary, and ordered readable units. */
export interface ParsedDocument { ref: DocumentRef; summary: string; units: readonly DocumentUnit[] }
/** Cursor selecting a bounded ordered unit range. */
export interface DocumentCursor { index: number; limit?: number }
/** One decoded XLSX worksheet with bounded typed cell rows. */
export interface SpreadsheetSheet { name: string; rows: readonly (readonly (string | number | boolean | null)[])[] }
/** Ordered worksheets decoded from one verified XLSX package. */
export interface ParsedSpreadsheet { sheets: readonly SpreadsheetSheet[] }

/** Stable parser error with a caller-actionable category. */
export class DocumentError extends Error {
  constructor(message: string, readonly code: 'unsupported' | 'invalid' | 'too-large' | 'encrypted' | 'corrupt' = 'invalid') { super(message); this.name = 'DocumentError' }
}

const MEDIA: Record<DocumentKind, DocumentMediaType> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const EXT: Record<string, DocumentKind> = { '.pdf': 'pdf', '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' }
const cleanName = (name?: string): string | undefined => {
  if (name === undefined) return undefined
  const leaf = name.replaceAll('\\', '/').split('/').at(-1)
  return leaf === undefined ? undefined : leaf.slice(0, 240) || undefined
}
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function xmlText(value: string): string {
  return decodeXml(value)
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<\/(?:w:p|a:p)>/g, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}
function kindFor(name: string | undefined, mediaType: string): DocumentKind {
  const ext = name && EXT[name.toLowerCase().slice(name.lastIndexOf('.'))]
  const byMedia = (Object.keys(MEDIA) as DocumentKind[]).find(k => MEDIA[k] === mediaType)
  if (ext && byMedia && ext !== byMedia) throw new DocumentError('File extension and MIME type disagree.', 'invalid')
  if (ext) return ext
  if (byMedia) return byMedia
  throw new DocumentError('Only PDF, DOCX, XLSX, and PPTX files are accepted.', 'unsupported')
}
function uint16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | (data[offset + 1] ?? 0) << 8
}

function uint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0)
    | (data[offset + 1] ?? 0) << 8
    | (data[offset + 2] ?? 0) << 16
    | (data[offset + 3] ?? 0) << 24
  ) >>> 0
}

function requiredEntry(entries: Record<string, Uint8Array>, name: string): Uint8Array {
  const entry = entries[name]
  if (entry === undefined) throw new DocumentError(`Office archive entry ${name} is missing.`, 'corrupt')
  return entry
}

function preflightZip(data: Uint8Array, limits: DocumentLimits): void {
  let eocd = -1
  for (let offset = data.byteLength - 22; offset >= Math.max(0, data.byteLength - 65_557); offset -= 1) {
    if (uint32(data, offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new DocumentError('The Office archive has no valid central directory.', 'corrupt')
  const count = uint16(data, eocd + 10)
  if (count > limits.maxArchiveEntries) throw new DocumentError('The Office archive contains too many entries.', 'too-large')
  let offset = uint32(data, eocd + 16)
  let expanded = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.byteLength || uint32(data, offset) !== 0x02014b50) throw new DocumentError('The Office archive central directory is corrupt.', 'corrupt')
    const flags = uint16(data, offset + 8)
    const compressed = uint32(data, offset + 20)
    const uncompressed = uint32(data, offset + 24)
    const nameLength = uint16(data, offset + 28)
    const extraLength = uint16(data, offset + 30)
    const commentLength = uint16(data, offset + 32)
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new DocumentError('ZIP64 Office archives are not accepted.', 'too-large')
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > data.byteLength) throw new DocumentError('The Office archive central directory is truncated.', 'corrupt')
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength))
    if ((flags & 1) !== 0) throw new DocumentError('Encrypted Office files are not accepted.', 'encrypted')
    if (name.includes('..') || name.includes('\\') || name.includes(':') || name.startsWith('/')) throw new DocumentError('The Office archive contains an unsafe path.', 'invalid')
    expanded += uncompressed
    if (expanded > limits.maxExpandedBytes || uncompressed > limits.maxExpandedBytes || (uncompressed > 0 && (compressed === 0 || uncompressed > compressed * limits.maxCompressionRatio))) throw new DocumentError('The Office archive expands beyond the configured limit.', 'too-large')
    offset = end
  }
}

function zipEntries(data: Uint8Array, limits: DocumentLimits): Record<string, Uint8Array> {
  preflightZip(data, limits)
  let entries: Record<string, Uint8Array>
  try { entries = unzipSync(data, { filter: file => !file.name.includes('\\') && !file.name.startsWith('/') }) } catch { throw new DocumentError('The Office archive is corrupt or encrypted.', 'corrupt') }
  for (const name of Object.keys(entries)) {
    if (name.includes('..') || name.includes(':')) throw new DocumentError('The Office archive contains an unsafe path.', 'invalid')
  }
  if (!entries['[Content_Types].xml']) throw new DocumentError('The Office archive has no content types manifest.', 'invalid')
  const contentTypes = strFromU8(entries['[Content_Types].xml'])
  if (/vbaProject|macroEnabled|encryptedPackage|EncryptedPackage/i.test(contentTypes) || Object.keys(entries).some(k => /vbaProject|\bmacros\b/i.test(k))) throw new DocumentError('Macro-enabled and encrypted Office files are not accepted.', 'encrypted')
  return entries
}
async function pdfUnits(data: Uint8Array, limits: DocumentLimits): Promise<DocumentUnit[]> {
  const raw = new TextDecoder('latin1').decode(data)
  if (!raw.startsWith('%PDF-')) throw new DocumentError('The PDF magic header is invalid.', 'invalid')
  if (/\/Encrypt\b/.test(raw)) throw new DocumentError('Encrypted PDFs are not accepted.', 'encrypted')
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: true,
      stopAtErrors: true,
    })
    const document = await task.promise
    const units: DocumentUnit[] = []
    try {
      for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, limits.maxUnits); pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim().slice(0, limits.maxCharacters)
        units.push({ index: pageNumber - 1, label: `Page ${pageNumber}`, text })
      }
    } finally {
      await document.destroy()
    }
    return units
  } catch (error) {
    if (error instanceof DocumentError) throw error
    if (error instanceof Error && error.name === 'PasswordException') throw new DocumentError('Encrypted PDFs are not accepted.', 'encrypted')
    throw new DocumentError('The PDF is corrupt or has an unsupported structure.', 'corrupt')
  }
}

function tagText(xml: string, localName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:(?:[A-Za-z][\\w.-]*):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z][\\w.-]*):)?${localName}>`, 'gi'))]
    .map(match => decodeXml((match[1] ?? '').replace(/<[^>]*>/g, '')))
}

function spreadsheetValue(cellXml: string, cellAttributes: string, sharedStrings: readonly string[]): string | number | boolean | null {
  const type = /\bt="([^"]+)"/.exec(cellAttributes)?.[1]
  if (type === 'inlineStr') return tagText(cellXml, 't').join('')
  const raw = tagText(cellXml, 'v')[0]
  if (raw === undefined) return null
  if (type === 's') return sharedStrings[Number(raw)] ?? ''
  if (type === 'b') return raw === '1'
  if (type === 'str' || type === 'e') return raw
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : raw
}

function columnIndex(reference: string | undefined, fallback: number): number {
  const letters = reference?.match(/^[A-Za-z]+/)?.[0]
  if (letters === undefined) return fallback
  let value = 0
  for (const letter of letters.toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64
  return value - 1
}

function spreadsheetRows(
  worksheetXml: string,
  sharedStrings: readonly string[],
  limits: DocumentLimits,
): (string | number | boolean | null)[][] {
  const rows: (string | number | boolean | null)[][] = []
  for (const rowMatch of worksheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    if (rows.length >= limits.maxSpreadsheetRows) break
    const row: (string | number | boolean | null)[] = []
    let sequentialColumn = 0
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attributes = cellMatch[1] ?? ''
      const index = columnIndex(/\br="([^"]+)"/.exec(attributes)?.[1], sequentialColumn)
      sequentialColumn = index + 1
      if (index >= limits.maxSpreadsheetColumns) continue
      while (row.length < index) row.push(null)
      row[index] = spreadsheetValue(cellMatch[2] ?? '', attributes, sharedStrings)
    }
    rows.push(row)
  }
  return rows
}

function spreadsheetFromEntries(entries: Record<string, Uint8Array>, limits: DocumentLimits): ParsedSpreadsheet {
  const sharedStrings = entries['xl/sharedStrings.xml'] === undefined
    ? []
    : [...strFromU8(entries['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
      .map(match => tagText(match[1] ?? '', 't').join(''))
  const names = Object.keys(entries)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  return {
    sheets: names.slice(0, limits.maxUnits).map((name, index) => ({
      name: `Sheet ${index + 1}`,
      rows: spreadsheetRows(strFromU8(requiredEntry(entries, name)), sharedStrings, limits),
    })),
  }
}

function officeUnits(kind: DocumentKind, entries: Record<string, Uint8Array>, limits: DocumentLimits): DocumentUnit[] {
  if (kind === 'xlsx') {
    return spreadsheetFromEntries(entries, limits).sheets.map((sheet, index) => ({
      index,
      label: sheet.name,
      text: sheet.rows.map(row => row.map(value => value ?? '').join('\t')).join('\n').slice(0, limits.maxCharacters),
    }))
  }
  const names = Object.keys(entries).filter(name => kind === 'docx'
    ? /^word\/document\.xml$/.test(name) || /^word\/header\d+\.xml$/.test(name) || /^word\/footer\d+\.xml$/.test(name)
    : /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const selected = names.length ? names : Object.keys(entries).filter(name => name.endsWith('.xml')).slice(0, limits.maxUnits)
  return selected.slice(0, limits.maxUnits).map((name, index) => ({
    index,
    label: kind === 'pptx' ? `Slide ${index + 1}` : `Section ${index + 1}`,
    text: xmlText(strFromU8(requiredEntry(entries, name))).slice(0, limits.maxCharacters),
  }))
}

/**
 * Validate and decode bounded worksheet cell values without executing formulas.
 * @param data - complete XLSX bytes.
 * @param input - declared display name and media type.
 * @param limits - encoded, expanded, entry, row, and column limits.
 * @returns ordered decoded worksheets.
 */
export function readSpreadsheet(
  data: Uint8Array,
  input: { name?: string; mediaType: string },
  limits: DocumentLimits = DEFAULT_DOCUMENT_LIMITS,
): ParsedSpreadsheet {
  if (data.byteLength === 0 || data.byteLength > limits.maxBytes) throw new DocumentError('Document exceeds the configured byte limit.', 'too-large')
  if (kindFor(input.name, input.mediaType) !== 'xlsx') throw new DocumentError('Spreadsheet analysis requires an XLSX file.', 'unsupported')
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new DocumentError('Office file is not a ZIP archive.', 'invalid')
  return spreadsheetFromEntries(zipEntries(data, limits), limits)
}

/**
 * Validate, hash, and parse a document without executing formulas, links, macros, or embedded content.
 * @param data - complete encoded PDF or Office bytes.
 * @param input - declared display name and media type.
 * @param limits - admission and extraction limits.
 * @returns verified metadata and bounded readable units.
 */
export async function readDocument(
  data: Uint8Array,
  input: { name?: string; mediaType: string },
  limits: DocumentLimits = DEFAULT_DOCUMENT_LIMITS,
): Promise<ParsedDocument> {
  if (data.byteLength === 0 || data.byteLength > limits.maxBytes) throw new DocumentError('Document exceeds the configured byte limit.', 'too-large')
  const kind = kindFor(input.name, input.mediaType)
  let units: DocumentUnit[]
  if (kind === 'pdf') units = await pdfUnits(data, limits)
  else {
    if (data[0] !== 0x50 || data[1] !== 0x4b) throw new DocumentError('Office file is not a ZIP archive.', 'invalid')
    units = officeUnits(kind, zipEntries(data, limits), limits)
  }
  const characters = units.reduce((n, u) => n + u.text.length, 0)
  const summary = units.map(u => `${u.label}: ${u.text}`).join('\n').slice(0, limits.maxCharacters)
  const name = cleanName(input.name)
  const ref: DocumentRef = {
    sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
    kind,
    mediaType: MEDIA[kind],
    bytes: data.byteLength,
    ...(name === undefined ? {} : { name }),
  }
  return { ref, summary: characters ? summary : '(No readable text found.)', units }
}

/**
 * Read a bounded page, slide, or worksheet range using an opaque cursor index.
 * @param document - parsed document returned by {@link readDocument}.
 * @param cursor - zero-based unit position and optional count.
 * @returns selected units and a next cursor when more units remain.
 */
export function readDocumentCursor(
  document: ParsedDocument,
  cursor: DocumentCursor = { index: 0, limit: 1 },
): { items: readonly DocumentUnit[]; nextCursor?: DocumentCursor } {
  const start = Math.max(0, Math.floor(cursor.index))
  const count = Math.min(20, Math.max(1, Math.floor(cursor.limit ?? 1)))
  const items = document.units.slice(start, start + count)
  return items.length > 0 && start + items.length < document.units.length
    ? { items, nextCursor: { index: start + items.length, limit: count } }
    : { items }
}
