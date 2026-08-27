---
sdd:
  id: capability.web.public-fetch
  kind: capability
  status: implemented
  owners:
    - web-platform
    - xiaowei-platform
  requirements:
    - id: REQ-web-public-fetch-001
      text: Web search and fetch execute through host-selected providers whose availability and credentials do not depend on the conversation model.
    - id: REQ-web-public-fetch-002
      text: The anonymous HTTP fetch provider connects only to a DNS-resolved public address that it validated and pinned, and it repeats validation for every redirect while preserving URL, time, size, content-type, and cancellation limits.
    - id: REQ-web-public-fetch-003
      text: An explicit fetch fallback may run only after the primary safely returns HTTP 403 or 429; blocked destinations, redirects, transport failures, timeouts, cancellation, and representation failures never trigger fallback.
    - id: REQ-web-public-fetch-004
      text: Xiaowei fetches public HTML and text through guarded HTTP without requiring a Firecrawl credential, and public GitHub repository or file URLs use GitHub's anonymous official content endpoints while retaining the submitted source URL.
  acceptance:
    - id: ACC-web-public-fetch-001
      text: Focused provider checks reject private, reserved, link-local, multicast, unspecified, and mixed public/private DNS answers for IPv4, IPv6, and IPv4-mapped IPv6, pin the validated address for connection, and repeat validation at redirects.
      evidence:
        - packages/web/web-fetch-http/tests/fetch-http.spec.ts
    - id: ACC-web-public-fetch-002
      text: Runtime checks prove that only HTTP 403 and 429 results enter the configured fetch fallback, a missing fallback credential preserves the primary result, and every other result or failure stays on the primary path.
      evidence:
        - packages/web/web/tests/web.spec.ts
    - id: ACC-web-public-fetch-003
      text: An assembled Xiaowei composition exposes web_fetch with guarded HTTP as primary and Firecrawl as fallback, deterministic provider checks retrieve GitHub repository and raw-file content through official endpoints without credentials, and the assembled runtime rejects a private destination before network access.
      evidence:
        - packages/web/web-fetch-http/tests/fetch-http.spec.ts
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-web-public-fetch-004
      text: The model-visible fetch transcript retains bounded Markdown content, source URL, status, truncation state, and untrusted-content guidance through the shipped tool path.
      evidence:
        - packages/web/tool-web/tests/tool-web.spec.ts
        - examples/acp-agent/tests/snapshots/web-fetch/system-prompt.expected.md
  evidence:
    - packages/web/web/src/index.ts
    - packages/web/web-fetch-http/src/provider.ts
    - packages/web/web-fetch-http/src/policy.ts
    - packages/bundle/xiaowei/cordis.patch.yml
    - packages/bundle/xiaowei/agent-presets/xiaowei-safe/agent.cordis.yml
  decisions:
    - .agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md
    - .agents/notes/implemented/feature/2026-08-25-firecrawl-web-research-provider.md
---
# Public web fetch

English | [中文](public-fetch.zh.md)

This capability gives model-facing web research a host-owned retrieval path that remains stable when a Session changes its conversation model. Search discovers URLs through its configured provider, while fetch retrieves a selected public URL through a separately configured provider chain.

## Capability

`ctx.web` owns search and fetch provider selection. `@deepseek-ai/dsh-web-fetch-http` owns anonymous public HTTP transport and destination enforcement. `@deepseek-ai/dsh-tool-web` keeps the stable model-facing schema and converts fetched HTML to bounded Markdown. Xiaowei selects guarded HTTP as its fetch primary and Firecrawl as an optional fallback.

## Requirements

### REQ-web-public-fetch-001

Provider selection, credentials, network requests, and response decoding belong to the host runtime. The conversation model decides whether and how to call the stable tool but does not supply or select its network backend.

### REQ-web-public-fetch-002

The direct provider accepts only credential-free HTTP(S) URLs. It resolves the hostname, rejects the complete answer when any address is not public, pins validated addresses into each connection attempt, rotates them across bounded transport retries under one deadline, and repeats destination validation before each redirect request. Response byte, decoded-character, redirect, timeout, content-type, and cancellation limits remain enforced.

### REQ-web-public-fetch-003

Fallback is a narrow availability aid rather than an error-hiding priority chain. Only a safely retrieved HTTP 403 or 429 response may enter the explicit fallback. A missing fallback credential returns the primary response; any other fallback failure remains visible. Primary safety, transport, timeout, cancellation, redirect, and representation failures never dispatch the fallback.

### REQ-web-public-fetch-004

Xiaowei can read public GitHub repository README and file content without a Firecrawl key. The direct provider maps repository roots to GitHub's anonymous README API and GitHub or `raw.githubusercontent.com` file URLs to the anonymous Contents API with GitHub's raw response media type, retains the submitted URL in the result, and applies the same public-address and resource limits to the official content endpoint. Private repositories, issues, pull requests, and authenticated GitHub operations remain outside anonymous fetch and require an account-scoped GitHub integration.

## Acceptance

### ACC-web-public-fetch-001

Provider policy and transport tests exercise literal addresses, DNS answers, rebinding-resistant connection pinning, and redirect revalidation without contacting a rejected destination.

### ACC-web-public-fetch-002

The web runtime tests the complete primary-result and fallback-error matrix through registered providers.

### ACC-web-public-fetch-003

A Loader composition verifies Xiaowei provider selection, tool visibility, and private-destination rejection. Provider integration tests verify repository and file URL mapping, official-endpoint request headers, source-URL retention, and raw-text responses, while a separate live acceptance probe exercises the real public hosts.

### ACC-web-public-fetch-004

The existing keyless tool snapshot and focused tool tests prove the model-visible Markdown and safety guidance.

## Decisions

The [web capability seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) owns provider separation, selection, and destination-security rationale.
