import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DocumentError, readDocument, readSpreadsheet } from '../src/index.ts'

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'

function archive(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries({ '[Content_Types].xml': CONTENT_TYPES, ...entries }).map(([name, value]) => [name, strToU8(value)])))
}

function textPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(source)
}

describe('document readers', () => {
  it('reads DOCX and PPTX text without executing document content', async () => {
    const docx = archive({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>季度报告</w:t></w:r></w:p><w:p><w:r><w:t>收入增长</w:t></w:r></w:p></w:body></w:document>' })
    const pptx = archive({ 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>销售趋势</a:t></a:r></a:p></p:sld>' })

    expect((await readDocument(docx, { name: 'report.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).summary).toContain('收入增长')
    expect((await readDocument(pptx, { name: 'deck.pptx', mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).units[0]?.text).toContain('销售趋势')
  })

  it('resolves shared strings and typed values from XLSX worksheets', async () => {
    const xlsx = archive({
      'xl/sharedStrings.xml': '<sst><si><t>地区</t></si><si><t>销售额</t></si><si><t>华东</t></si><si><t>华南</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>80</v></c></row></sheetData></worksheet>',
    })

    const workbook = readSpreadsheet(xlsx, { name: 'sales.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(workbook.sheets[0]?.rows).toEqual([['地区', '销售额'], ['华东', 120], ['华南', 80]])
    expect((await readDocument(xlsx, { name: 'sales.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).summary).toContain('华东\t120')
  })

  it('rejects encrypted or macro-enabled OOXML and mismatched declarations', async () => {
    const macro = archive({ 'word/document.xml': '<w:t>x</w:t>', 'word/vbaProject.bin': 'macro' })
    await expect(readDocument(macro, { name: 'unsafe.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).rejects.toBeInstanceOf(DocumentError)
    await expect(readDocument(Uint8Array.of(1), { name: 'wrong.xlsx', mediaType: 'application/pdf' })).rejects.toThrow('disagree')
  })

  it('rejects excessive ZIP expansion before parsing Office XML', async () => {
    const compressed = zipSync({ '[Content_Types].xml': strToU8(CONTENT_TYPES), 'word/document.xml': new Uint8Array(200_000) })
    await expect(readDocument(compressed, { name: 'large.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, {
      maxBytes: 1024 * 1024,
      maxExpandedBytes: 1024 * 1024,
      maxCompressionRatio: 2,
      maxCharacters: 10_000,
      maxUnits: 10,
      maxSpreadsheetRows: 10,
      maxSpreadsheetColumns: 10,
      maxArchiveEntries: 10,
    })).rejects.toThrow('expands beyond')
  })

  it('extracts embedded text from a valid PDF page', async () => {
    const parsed = await readDocument(textPdf('Quarterly report'), { name: 'report.pdf', mediaType: 'application/pdf' })
    expect(parsed.ref.kind).toBe('pdf')
    expect(parsed.units).toHaveLength(1)
    expect(parsed.units[0]?.text).toContain('Quarterly report')
  })

  it('normalizes Node buffers before passing PDF bytes to PDF.js', async () => {
    const parsed = await readDocument(Buffer.from(textPdf('Stored report')), { name: 'stored.pdf', mediaType: 'application/pdf' })
    expect(parsed.units[0]?.text).toContain('Stored report')
  })
})
