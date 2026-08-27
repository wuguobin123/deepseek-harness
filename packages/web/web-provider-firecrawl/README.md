# `@deepseek-ai/dsh-web-provider-firecrawl`

English | [中文](README.zh.md)

Registers one Firecrawl instance as both a `WebSearchProvider` and a `WebFetchProvider`. Search requests ask Firecrawl to extract main-content Markdown with every result, so `web_search` can ground an answer without a second site request. Fetch requests use Firecrawl's scrape endpoint for a known URL.

## Configuration

```yaml
- id: web-provider-firecrawl
  name: '@deepseek-ai/dsh-web-provider-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

`FIRECRAWL_API_URL` overrides the hosted `https://api.firecrawl.dev/v2` endpoint. A custom endpoint must use HTTPS; loopback HTTP is accepted for an independently deployed local service. `maxResponseBytes`, `maxSearchContentChars`, and `maxFetchBodyChars` bound untrusted remote data.

The provider resolves the credential for every call. A missing key raises `WEB_PROVIDER_CREDENTIAL_MISSING`, allowing `ctx.web` to use its configured credential fallback search provider.

## Security

API requests do not follow redirects. Scrape targets must be credential-free HTTP(S) URLs; loopback and private IP literals are rejected. Returned search content remains untrusted webpage data. The model-facing `dsh-tool-web` prompt instructs the model to use it only as evidence and cite the corresponding URL.

The package calls Firecrawl's public REST API and does not embed Firecrawl server code. Operators who self-host Firecrawl own that separate service's license and network-egress policy.

## Model Experience

Indirectly, through `dsh-tool-web`, which owns the model-visible schemas, untrusted-content guidance, and result rendering.

#### KV Cache effect

None from this provider. The consumer's fixed web guidance determines the reusable request prefix.

## Known Limitations and Deferred Work

- **External service dependency.** Search and scrape availability, quotas, licensing, and egress policy depend on the configured Firecrawl deployment.
- **No redirect following.** Redirecting search or scrape endpoints fail instead of being followed.
