# Agent Note: Xiaowei keyless search fallback

Status: implemented

English | [中文](2026-08-25-xiaowei-keyless-search-fallback.zh.md)

## Problem

Xiaowei routes account-owned chat through `xiaowei-minimax/MiniMax-M3`, while the base web bundle routes `web_search` through the separate DeepSeek Messages API. A MiniMax account therefore remains usable when no deployment-level `DEEPSEEK_API_KEY` exists, but every model-issued search fails with `WEB_PROVIDER_CREDENTIAL_MISSING`. Switching chat models does not repair the independent search provider.

The search seam previously selected exactly one provider and deliberately had no registration-order priority. Adding an unconditional catch-all fallback would hide rate limits, upstream outages, invalid responses, network failures, timeouts, and cancellations as successful provider switching, making operational failures difficult to diagnose.

## Decision

`dsh-web` accepts an explicit `searchCredentialFallbackProvider` beside an explicit, distinct `searchProvider`. The runtime resolves the primary on every call and tries the fallback only when the primary throws `WebError` with code `WEB_PROVIDER_CREDENTIAL_MISSING`. Every other error propagates unchanged. The environment equivalent is `DSH_WEB_SEARCH_CREDENTIAL_FALLBACK_PROVIDER`; it feeds the same configuration field and does not add a hidden priority chain.

`dsh-web-search-searxng` implements an anonymous search provider over the documented SearXNG `POST /search` JSON API. It accepts HTTPS endpoints and loopback HTTP endpoints, rejects redirects and embedded credentials, bounds response bodies, validates external JSON, omits non-HTTP(S) result URLs, and maps cancellation to `WEB_ABORTED`. It does not scrape a search-engine HTML page or depend on an unofficial public instance.

The Xiaowei patch selects `firecrawl` as the primary provider and `searxng` only as the missing-credential fallback. Provider execution belongs to the host runtime and therefore does not change when a Session switches its conversation model. The deployment sets `SEARXNG_BASE_URL` to `http://127.0.0.1:18081` by default; deployments may replace it through the launch-environment layer. Other bundles retain their existing selection.

## Deployment and security

`scripts/deploy_xiaowei.sh` deploys an official SearXNG container pinned by multi-architecture image digest. Docker publishes it only on `127.0.0.1`; nginx does not expose it. The generated SearXNG secret stays under `/etc/dsh-xiaowei/searxng`, the settings file is mounted read-only, container logs rotate, and the instance disables public-instance features and its public bot limiter because only the local Xiaowei process can reach it. No search API key is stored. The production settings keep only the keyless Bing China and Sogou engines because the host can reach both and both return results, while the image's default Brave, DuckDuckGo, Google CSE, Startpage, and Wikipedia engines time out from this network.

The deployment gate starts or updates SearXNG before restarting Xiaowei and submits a real JSON search that must return at least one source. A failed container start, invalid or empty JSON response, or unreachable loopback endpoint aborts the deployment before the application restart. The ordinary Xiaowei loopback and nginx health probes remain required after restart.

SearXNG aggregates upstream engines that may independently throttle, reject, or return no results. Those conditions remain visible as provider errors or empty results; they do not fall through to another hidden backend.

## Testing

Runtime unit tests prove successful missing-credential fallback, propagation of non-credential errors, and invalid fallback configuration. The SearXNG provider tests cover mapping, static endpoint policy, form requests, response caps, malformed and invalid JSON, network and stream failures, cancellation timing, plugin disposal, environment defaults, and its invariant companion with 100 percent per-file coverage.

A real Loader test boots the shipped base, headless, and Xiaowei bundle layers with no Firecrawl credential, calls `ctx.web.search`, and observes the local SearXNG JSON provider. A keyless browser snapshot replays a model-issued `web_search` turn, proves no auxiliary search-model request was emitted, and verifies the durable successful source list visible to the model and client.

## Production acceptance

The 2026-08-25 scoped rollout preserved `/opt/dsh-xiaowei.bak-20260825T040147Z`, deployed the pinned SearXNG container on `127.0.0.1:18081`, and restarted `dsh-xiaowei` with zero automatic restarts. Loopback and nginx health checks returned `ok`, the composed profile named `deepseek-official` with fallback `searxng`, and a production seam probe with `DEEPSEEK_API_KEY` explicitly absent returned five bounded sources for `济南 天气`, including China Weather and the National Meteorological Center. Runtime file hashes matched the scoped local artifacts after deployment.

## Alternatives considered

**Use DuckDuckGo HTML scraping in the Node process.** DuckDuckGo offers no official general search API for this use, and HTML scraping couples the product to undocumented markup and bot controls. A self-hosted SearXNG instance provides a documented JSON interface and isolates engine churn outside the application process.

**Use a free public SearXNG or proxy endpoint.** Public instances have external availability, privacy, rate-limit, and policy dependencies that the deployment cannot control. The loopback-only instance keeps request handling within the managed host while still relying on the selected upstream engines for public results.

**Fallback on every primary failure.** This would turn DeepSeek 401, 429, 5xx, timeout, cancellation, parsing, and network failures into a different backend response. The implementation falls back only before the primary can dispatch because the named credential is absent.

**Replace DeepSeek search globally.** Deployments with a configured DeepSeek search credential retain its auxiliary model behavior. Xiaowei alone needs a no-key path because its chat credential is account-owned and belongs to a different provider.

## Consequences

Xiaowei can search without configuring a DeepSeek model or search key, while operators still see genuine provider failures. Production now depends on the pinned SearXNG container and on the public engines it aggregates. Operators must monitor the loopback container, deliberately update its digest, preserve the generated settings directory, and review upstream SearXNG changes and license obligations when upgrading.
