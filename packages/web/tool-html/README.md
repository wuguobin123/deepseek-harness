# `@deepseek-ai/dsh-tool-html`

English | [中文](README.zh.md)

`html_build` delivery tool for self-contained web artifacts. It persists complete HTML bytes through `ctx.artifactRegistry` and returns metadata for sandboxed iframe preview.

## Delivery contract

The model supplies a complete document with doctype, head, and body. Every asset must be inlined as data or page content because the preview cannot fetch external resources. Optional structured metadata is stored beside the artifact.

## Model Experience

### Tool schema

#### What the model sees

The generated [`html_build` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-html) accepts the full HTML document, an optional title, and optional presentation metadata.

#### Token effect

One tool definition and fixed self-contained-delivery guidance enter the request. Calls may carry large HTML, while results retain only compact artifact metadata.

#### KV Cache effect

The schema and guidance form stable prefix content. Generated HTML appears only in the appended tool call.

## Known Limitations and Deferred Work

- **No external asset loading.** Fonts, images, scripts, and styles must be embedded in the delivered file.
- **No multi-file site bundle.** The tool stores one HTML document rather than a directory tree.
