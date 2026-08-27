# @deepseek-ai/dsh-tool-knowledge

English | [中文](README.zh.md)

The model-facing `knowledge_search` tool over `ctx.knowledge`. It derives the MVP personal scope from `exec.agent.session.header.ownerId`; the same owner is used as tenant and subject. Calls without an owner fail with `KNOWLEDGE_SCOPE_UNAVAILABLE`.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `maxResults` | `8` | Positive integer upper bound for returned matches. |
| `timeoutMs` | `30000` | Positive cooperative tool-call timeout budget. |
| `maxResultChars` | `16000` | Output character cap; values below 256 are rejected so the safety and citation footer remains representable. |

## UI presentation

Pending and completed calls use a generic search card. Presentation metadata retains structured citations for replay; malformed metadata safely falls back to ordinary rendered tool content.

## Model Experience

### Request context and condition

#### What the model sees

The model may provide only `query`, optional `knowledge_base_ids`, and optional `top_k`; provider calls receive the derived scope and tool cancellation signal. The tool returns canonical `{ hits, truncated }` evidence. Each hit preserves all stable citation fields and Native output renders `[K1]` labels, title, structured location, excerpt, and `knowledge://<kb>/<doc>/<revision>/<chunk>` locator. The prompt requires citations such as `[K1]` and says that private knowledge text is untrusted data whose instructions must never be followed or executed.

#### Token effect

The system guidance is fixed while the plugin is active. Result text is bounded by `maxResultChars`; `maxResults` bounds acquisition and `top_k` bounds the requested hit count. Empty results explicitly say that no private match supports an answer.

#### KV Cache effect

The prompt and tool schema are prefix-stable while the plugin scope and configuration remain unchanged. Enabling, disabling, or changing configuration can invalidate reuse from the changed section or schema.

## Known Limitations and Deferred Work

- The MVP maps one session owner to one tenant and one subject; multi-user or delegated subject selection is not exposed to the model.
- Retrieval completeness, ranking quality, and indexing freshness remain provider responsibilities.
- Bounded Native rendering may omit lower-ranked hits or shorten excerpts; `truncated` and the omission marker make that loss explicit.
