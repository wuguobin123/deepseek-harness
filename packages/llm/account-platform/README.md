# @deepseek-ai/dsh-llm-account-platform

English | [中文](README.zh.md)

Account-scoped model consumer for Xiaowei. The configured route requires an account-owned session, resolves or provisions the user's model credential, reserves a conservative wallet amount before the provider attempt, and settles actual usage before the terminal stream chunk. Credential values are handed to `llm-pi-ai` through a process-local `WeakMap`; they are never placed in model-visible options or session events.

`missingUsagePolicy` controls a provider response without usage: `cancel` releases the hold, while `reserve` settles the full conservative amount. Every provider attempt owns a separate reservation. Other routes pass through unchanged.

`providerCacheReadReserveTokens` adds a conservative allowance for provider-owned cached prefixes that do not appear in request JSON. The default protects short requests from exceeding their wallet reservation when the upstream reports such cache reads.

The same plugin registers the fixed `xiaowei-custom` BYOK route. A custom selection uses an opaque custom-model id; execution resolves `sessionId → ownerId → resolveCustom()` and constructs a one-request pi-ai profile from the stored protocol, public HTTPS base URL, upstream model id, and decrypted key. This route never falls back to environment credentials and never uses the wallet. The endpoint hostname is resolved before every dispatch; private, loopback, link-local, metadata, and non-public literal addresses are rejected. `customModelAllowedHosts` optionally narrows dispatch to an exact deployment allowlist.

## Model Experience

None, as credential resolution, wallet accounting, and endpoint policy remain outside the assembled model request.

#### KV Cache effect

None. The selected provider receives the same assembled request prefix.

## Known Limitations and Deferred Work

- **Account ownership is mandatory.** The configured account route rejects anonymous and unowned Sessions rather than falling back to deployment credentials.
- **Custom endpoints must be public HTTPS hosts.** Private-network, loopback, link-local, metadata, and non-public literal addresses are intentionally unsupported.
