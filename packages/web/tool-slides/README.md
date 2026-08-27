# `@deepseek-ai/dsh-tool-slides`

English | [中文](README.zh.md)

`slides_build` delivery tool for Reveal.js decks. It renders a cover plus ordered Markdown slides into self-contained HTML with inlined themes, persists `kind: 'slides'`, and returns preview metadata.

## Deck format

The input carries an optional cover, theme, title, and body slides shaped as `{ title?, bodyMarkdown }`. The renderer owns the Reveal.js page structure and inline assets; the artifact panel loads the delivered bytes directly.

## Model Experience

### Tool schema

#### What the model sees

The generated [`slides_build` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-slides) accepts the optional cover and theme plus an ordered array of slide content.

#### Token effect

One tool definition and fixed deck-authoring guidance enter the request. Slide source is carried by the call; the result keeps compact artifact metadata.

#### KV Cache effect

The schema and guidance remain stable prefix content. Each deck call and result appends after that prefix.

## Known Limitations and Deferred Work

- **One delivered format.** The package produces Reveal.js HTML, not PPTX or Google Slides.
- **No PDF export.** Printable deck output requires a separate headless export service.
