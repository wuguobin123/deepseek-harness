# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

`document_read` reads bounded text from a PDF, DOCX, XLSX, or PPTX attachment recorded by the current Session. The tool accepts only the opaque `attachmentId`; it resolves the complete reference from durable `user/message` source metadata before reading storage, so a model cannot manufacture a reference to another Session's file.

## Model Experience

### System prompt

#### What the model sees

Fixed guidance restricts `document_read` to current-Session files, describes cursor-based unit reads, and states that formulas, macros, links, embedded files, OCR, and legacy binary Office formats are not interpreted.

##### Document-read guidance

```markdown
Use document_read only for a file attached to the current session. Read one page, slide, worksheet, or a bounded cursor range; formulas, macros, links, embedded files, OCR, and binary legacy Office formats are not executed or interpreted.
```

#### Token effect

Fixed while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### Tool schema and result

#### What the model sees

The generated [`document_read` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-document) accepts an attachment id and optional cursor. A successful result carries verified metadata, a bounded summary and units, and a next cursor when more units remain; ownership or parser failures return an error without file bytes.

#### Token effect

The schema has fixed cost; each result is data-dependent and capped by `maxCharacters` and the cursor limit.

#### KV Cache effect

Results append after the reusable request prefix; config, schema, or tool visibility changes may invalidate reuse from the changed definition.

## Known Limitations and Deferred Work

- OCR and scanned-PDF recognition are not provided.
- Formulas, links, macros, embedded objects, encrypted files, and legacy binary Office files are not interpreted or accepted.
