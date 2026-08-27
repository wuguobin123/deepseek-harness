# `@deepseek-ai/dsh-tool-doc`

English | [中文](README.zh.md)

`doc_build` delivery tool for semantic HTML or Markdown documents. It renders ordered Markdown sections, persists a `kind: 'doc'` artifact, and returns metadata for the document preview panel.

## Formats

`html` is the default stored format and wraps rendered sections in a self-contained page. `markdown` preserves a Markdown deliverable. The artifact is the source of truth; this package does not generate DOCX or Google Docs files.

## Model Experience

### Tool schema

#### What the model sees

The generated [`doc_build` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-doc) accepts a title, output format, and ordered `{ heading?, bodyMarkdown }` sections.

#### Token effect

One tool definition and fixed document-delivery guidance enter the request. The model supplies section content, while the retained result contains compact artifact metadata.

#### KV Cache effect

The schema and guidance remain in the reusable request prefix; document calls and results append afterward.

## Known Limitations and Deferred Work

- **No office-document export.** DOCX and Google Docs output require a separate exporter.
- **No PDF in this tool.** Printable output belongs to a separate PDF export path.
