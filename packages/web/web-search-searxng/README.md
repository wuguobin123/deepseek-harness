# @deepseek-ai/dsh-web-search-searxng

English | [中文](README.zh.md)

An anonymous `WebSearchProvider` for a self-hosted [SearXNG](https://docs.searxng.org/) instance. It sends `POST /search` form data (`q` and `format=json`) and maps SearXNG `results[]` into normalized web sources.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `$SEARXNG_BASE_URL`, `http://localhost:8080` | SearXNG base URL. HTTPS is allowed; HTTP is restricted to loopback hosts. |
| `maxResponseBytes` | `1048576` | Maximum response size. Must be a positive integer. |

```yaml
- id: web-search-searxng
  name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    baseURL: http://127.0.0.1:8080
```

Malformed JSON, invalid response structures, non-2xx responses, oversized bodies, network failures, and redirects surface as `WebError` `WEB_PROVIDER_ERROR`; cancellation is `WEB_ABORTED`. Results with non-HTTP(S) URLs are omitted. `available()` only validates static configuration and never makes a network request.

## Model Experience

Indirectly, through `dsh-tool-web`, which renders normalized SearXNG sources or provider errors into the conversation model's tool result.

#### KV Cache effect

Append-only; newly returned sources follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- Anonymous access removes an API-key requirement but does not guarantee upstream-engine availability; individual engines can throttle, block, or return no results.
- The provider returns SearXNG result metadata only; answer synthesis remains the conversation model's responsibility.
