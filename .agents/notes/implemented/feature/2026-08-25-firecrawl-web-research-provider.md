# Agent Note: Firecrawl-backed web research retrieval

Status: implemented

English | [中文](2026-08-25-firecrawl-web-research-provider.zh.md)

## Problem

The existing loopback SearXNG provider returns search results but does not provide the extracted main-content evidence needed for source-grounded research in one request. Adding another agent framework would duplicate the existing `web_search` consumer and agent loop, while enabling unrestricted explicit fetch would expose a capability before profile-scoped safe composition exists.

## Decision

Xiaowei uses Firecrawl as its primary web search provider. Search requests include Firecrawl main-content Markdown extraction, allowing the existing `web_search` consumer and agent loop to perform source-grounded synthesis without adopting another agent framework. A missing `FIRECRAWL_API_KEY` falls back to the existing loopback SearXNG provider.

The `@deepseek-ai/dsh-web-provider-firecrawl` package also implements `WebFetchProvider` through Firecrawl scrape. The generic standard preset keeps explicit fetch disabled. Xiaowei's profile-scoped preset enables it with guarded anonymous HTTP as the primary provider and Firecrawl as a distinct fallback that runs only after a safe HTTP 403 or 429 result.

## Safety and limits

The provider uses the v2 REST API with redirect following disabled, validates external JSON, caps response bytes and retained text, and accepts custom HTTP endpoints only on loopback. Scrape targets reject embedded credentials and private IP literals. The model-facing web prompt classifies all returned page text as untrusted evidence and requires citation of the corresponding URL.

The integration calls Firecrawl as an external service and does not copy its server implementation. Self-hosted deployments must apply the Firecrawl server license and restrict that service's network egress.

## Verification

Focused tests cover extracted search mapping, request fields, scrape truncation, URL restrictions, missing credentials, cancellation, HTTP failures, malformed JSON, response size limits, and the model-facing untrusted-content prompt.

## Alternatives considered

**Keep SearXNG as the only provider.** It remains a keyless loopback fallback, but it does not supply Firecrawl's main-content extraction in the primary search response.

**Adopt Firecrawl's agent orchestration.** The harness already owns the model loop, tool schema, session log, and citation prompt. Only search and scrape provider behavior is integrated.

**Enable explicit fetch in every standard preset.** Fetch visibility remains a product decision. The generic preset stays search-only, while Xiaowei opts in because its bundle mounts the guarded provider and its restricted fallback together.

## Consequences

Configured deployments gain extracted Markdown evidence through the existing `web_search` tool, while missing credentials preserve the SearXNG fallback. Firecrawl is an external availability, licensing, and network-egress dependency for the configured search primary, but ordinary Xiaowei public-page fetches do not require it.

The provider must continue validating external responses, bounding retained content, and rejecting unsafe scrape targets. Xiaowei's explicit fetch remains coupled to guarded HTTP, and primary safety or transport failures never dispatch Firecrawl.
