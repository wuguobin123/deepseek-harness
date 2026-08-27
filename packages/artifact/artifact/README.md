# `@deepseek-ai/dsh-artifact`

English | [中文](README.zh.md)

Durable artifact-registry Service Definition for renderable HTML, slides, documents, sheets, and charts. `ctx.artifactRegistry` admits bounded bytes, returns content-addressed `ArtifactRef` values, and enforces workspace and Session ownership when artifacts are read.

## Service surface

`ArtifactRegistry.write()` validates kind, media type, source, ownership, content size, and metadata before delegating storage. `get()` resolves one owned artifact, while `list()` returns the bounded records visible to a workspace and optional Session. `ArtifactError` distinguishes admission, not-found, ownership, and storage failures.

## Model Experience

Indirectly, through artifact-producing tools that own their model schemas and render the returned references.

#### KV Cache effect

None from the registry. Producing tools add their own schemas and results after request assembly.

## Known Limitations and Deferred Work

- **The seam does not render artifacts.** Client presentation and export formats belong to consumers.
- **Content is immutable by id.** Replacing bytes creates a new digest and artifact id rather than updating a stored object.
