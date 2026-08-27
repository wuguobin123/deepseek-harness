# Agent Note: Office file upload and analysis

Status: implemented

English | [中文](2026-08-26-office-file-upload-and-analysis.zh.md)

## Problem

The conversation composer accepted images but could not admit PDF or modern Office files, and the existing sheet artifact path could render model-supplied rows but could not analyze an uploaded workbook. Passing raw browser bytes or paths into the Session would violate the durable attachment rule, while accepting a model-supplied file reference would permit cross-Session reads.

## Decision

The attachment seam admits PDF, DOCX, XLSX, and PPTX bytes under deployment-configured count and byte limits. The local provider validates the declared extension and media type, rejects unsafe OOXML archives, stores the original bytes under their SHA-256 identity, and returns a durable `DocumentAttachmentRef` carrying a bounded server-generated summary. The prompt endpoint records the reference in the existing `user/message` source and appends the summary as text, so every model-visible input remains reconstructable without adding a new content block or Session event.

`document_read` accepts only an attachment id and resolves its complete reference from the current Session's event stream before reading storage. It exposes bounded page, section, slide, or worksheet units with a cursor. PDF extraction is limited to embedded text; the reader does not perform OCR, execute formulas or macros, follow links, or load embedded objects.

`sheet_analyze` applies the same current-Session ownership check to XLSX files, resolves shared strings and cached cell values, and writes a self-contained `kind: 'sheet'` HTML artifact. The page contains a semantic table plus inline SVG bar and pie charts, and the existing artifact result card and sandboxed right-side preview render the persisted bytes.

The browser keeps selected files as temporary drafts until send. A visible file picker and document-wide drop target accept images and the four document formats, preserve mixed-batch order, and render Office files as named tiles instead of broken image thumbnails.

## Security and limits

OOXML admission requires a ZIP package with `[Content_Types].xml`, rejects path traversal, encrypted packages, macros, excessive expanded bytes, and excessive compression ratios, and bounds units, worksheet rows, columns, and extracted characters. Legacy DOC, XLS, and PPT files are outside the accepted media types.

## Alternatives considered

**Persist base64 or local paths in the Session.** This would enlarge durable logs, expose machine-local details, and bypass content-addressed integrity checks, so the Session retains only the immutable reference and bounded text.

**Let the model submit a complete document reference.** A structurally valid reference does not prove Session ownership, so tools accept only the opaque id and resolve the authoritative reference from the current Session.

**Create a separate chart preview protocol.** The existing sheet artifact already provides persistence, Session association, result cards, and sandboxed HTML rendering, so the analysis page reuses it and keeps charts as inline SVG.

## Consequences

Users can upload and analyze the supported document formats, and an XLSX analysis can open as a durable right-side page with both requested chart types. The lightweight reader deliberately gives up OCR, legacy Office compatibility, formula evaluation, workbook styling, and complete PDF layout reconstruction. Verification covers format rejection, XLSX shared strings, cross-Session denial, mixed image/document submission, artifact ownership, and chart HTML generation; packaged Electron interaction remains a separate release acceptance gate.
