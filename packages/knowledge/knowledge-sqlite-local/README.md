# `@deepseek-ai/dsh-knowledge-sqlite-local`

English | [中文](README.zh.md)

Local single-process `KnowledgeProvider` for the MVP. It stores metadata, immutable revisions, chunks, vectors, ingestion jobs, and an FTS5 index in one owned SQLite database. Every operation predicates on both `tenant_id` and `subject_id`; opaque knowledge-base, document, job, revision, and chunk ids are not authorization.

Plain-text and Markdown ingestion runs asynchronously after `startIngest()` persists a queued job. The provider consumes the runtime-bounded stream, validates UTF-8, chunks text with configured overlap, embeds the chunks, then transactionally publishes the document, revision, vector rows, FTS rows, and succeeded job state. Failures and cancellation become terminal job states without publishing partial search rows.

Search combines reciprocal SQLite `bm25()` relevance with cosine similarity using normalized configured weights. Vector comparison occurs only when stored and query model, revision, and dimensions are identical. An explicitly empty knowledge-base list returns no hits; omission means all bases visible in the supplied scope.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `path` | `:memory:` | Owned SQLite database path. Persistent deployments must configure a file path. |
| `id` | `sqlite-local` | Knowledge-provider registry id. |
| `chunkChars` | `1200` | Positive character cap per chunk. |
| `chunkOverlapChars` | `120` | Overlap between chunks; must be smaller than `chunkChars`. |
| `keywordWeight` | `0.35` | Non-negative FTS5 contribution. |
| `vectorWeight` | `0.65` | Non-negative cosine contribution. At least one weight must be positive. |

## Model Experience

### Request context and condition

#### What the model sees

Nothing directly from this provider. `dsh-tool-knowledge` may render bounded `ctx.knowledge.search()` hits as cited evidence, while tenant and subject values remain trusted runtime data.

#### Token effect

Zero direct agent-model tokens. The embedding adapter may incur its own token or billing cost, and the Consumer controls retrieved excerpt tokens.

#### KV Cache effect

This provider does not change model-request prefixes. Search results are variable tool output after the reusable prefix.

## Known Limitations and Deferred Work

- **MVP parsers** — only UTF-8 `text/plain` and `text/markdown` are accepted; PDF, Office, HTML, OCR, source-location extraction, and structured parser plugins are deferred.
- **Single-process storage** — the provider has no distributed worker, cross-process writer coordination, resumable upload, or remote vector database.
- **Deployment security** — encryption at rest, quotas, retention, malware inspection, audit exports, and organization membership authorization belong to later product layers.
- **Quality** — production semantic embeddings, reranking, filters, evaluation datasets, relevance telemetry, and index migration/rebuild orchestration are not included.
