# @deepseek-ai/dsh-document

English | [中文](README.zh.md)

Bounded readers for PDF and modern Office Open XML files. `readDocument` verifies the declared extension and media type, rejects encrypted or macro-enabled archives, limits encoded and expanded bytes, and returns page, section, slide, or worksheet units plus a short summary. `readSpreadsheet` resolves XLSX shared strings and cached cell values into bounded rows without executing formulas, external links, macros, or embedded objects.

## Model Experience

### Consumer-owned parser output

#### What the model sees

No direct package-owned context. `@deepseek-ai/dsh-tool-document` and `@deepseek-ai/dsh-tool-sheet` decide which bounded parser outputs enter model history.

#### Token effect

Zero direct tokens; consumer tool results are data-dependent and bounded by their own configuration.

#### KV Cache effect

No direct effect. Consumer tool results determine the data-dependent history added after an existing reusable prefix.

## Known Limitations and Deferred Work

- Supported formats are PDF, DOCX, XLSX, and PPTX. Legacy DOC, XLS, and PPT files are rejected.
- PDF extraction reads embedded text only. Scanned documents require a separate OCR capability.
- XLSX date formatting and calculated formula results use the cached value stored in the workbook; formulas are never evaluated.
