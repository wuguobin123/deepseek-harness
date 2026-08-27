# User model keys

English | [中文](README.zh.md)

This package ensures one New-API token per user and provider route. Management credentials are used only on the server; upstream tokens are encrypted with AES-256-GCM in SQLite and are never returned by account RPCs. `resolveActive()` is the internal model-consumer path and records `last_used_at`.

The same service stores account-owned custom OpenAI-compatible models in `user_custom_models`. `createCustom()` validates and normalizes the label, public HTTPS base URL, protocol, upstream model id, and key; only the encrypted key is durable. `listCustom()` returns metadata without the key, `removeCustom()` revokes only an owned active row, and `resolveCustom()` decrypts an owned active row only for the in-process model consumer. Custom model ids are opaque and active rows are limited per account by `maxCustomModels`.

Prices are configured as CNY micros per token. Token quota and unlimited-quota behavior are explicit New-API settings. New-API management and model data-plane URLs are separate.

## Model Experience

None, as stored credentials and route metadata are resolved inside model adapters and never enter prompts or tool results.

#### KV Cache effect

None. Credential selection does not alter the assembled request prefix.

## Known Limitations and Deferred Work

- **One New-API service account per deployment.** Each route has one configured token policy.
- **Custom endpoint protocols are limited.** Only `openai-completions` and `openai-responses` are supported, and private-network endpoints are rejected.
