# `@deepseek-ai/dsh-tool-chart`

English | [中文](README.zh.md)

Model tools for durable charts. `mermaid_build` stores Mermaid source in a self-contained HTML harness; `svg_build` stores a sanitized SVG document. Both write `kind: 'chart'` artifacts through `ctx.artifactRegistry`.

## Safety and output

Mermaid diagrams use an inlined runtime and no CDN. SVG admission requires an `<svg>` root and rejects scripts, event-handler attributes, and elements or attributes outside the allowlist. Successful calls return artifact metadata for the chart card.

## Model Experience

### Tool schemas

#### What the model sees

The generated [`mermaid_build` and `svg_build` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-chart) accept a title plus Mermaid or SVG source and describe the supported and rejected forms.

#### Token effect

Two tool definitions and fixed chart guidance enter the request; successful calls retain compact artifact metadata instead of the full rendered bytes.

#### KV Cache effect

The schemas and guidance are stable request-prefix content. Tool calls and results append after that reusable prefix.

## Known Limitations and Deferred Work

- **No arbitrary SVG.** Unsupported elements and attributes are rejected even when a browser could render them.
- **No editable chart project.** The stored artifact is the delivered source or rendered harness, not a visual-editor document.
