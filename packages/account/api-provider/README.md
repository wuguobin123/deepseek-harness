# `@deepseek-ai/dsh-account-api-provider`

English | [中文](README.zh.md)

Cloud-only account route ownership for the Xiaowei Host API. The package owns account, wallet, model-key, custom-model, and account-plugin method classification, authenticated account Web Search forwarding, the account-owner policy, and error-code mapping. It has no dependency on the Host API gateway or the device runtime, so a device bundle can omit it entirely.

`assertRoutePartition` is the assembly gate: the complete wire method registry must be the disjoint union of the device-safe core routes and `ACCOUNT_RPC_METHODS`.

## Model Experience

The package is not model-visible by itself. Its Web Search route lets an authenticated Xiaowei session return normalized web sources through the regular `web_search` tool path.

#### KV Cache effect

None at assembly time; individual search results are appended after the reusable model-request prefix.

## Known Limitations and Deferred Work

- Account Web Search requires a valid authenticated principal and an available cloud search provider.
