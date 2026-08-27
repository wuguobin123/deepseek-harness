# Agent Note: Account-owned custom models in remote settings

Status: implemented

English | [中文](2026-08-25-account-custom-models.zh.md)

## Problem

The loopback Models editor writes Host-wide settings and credentials, so exposing it to an authenticated remote Xiaowei client would let one account change every account's provider configuration. Remote users still need to add their own OpenAI-compatible endpoint and key from Settings, see that model in their conversation picker, and use it without exposing the key or crossing account ownership.

## Decision

**Custom models are immutable account records, not Host provider profiles.** `user_custom_models` stores an opaque id, owner, display label, protocol, normalized public HTTPS base URL, upstream model id, AES-256-GCM encrypted key, creation time, and optional revocation time. `account.customModels.create/list/remove` derives the owner from the authenticated principal and never accepts a user id; list and mutation responses contain metadata only. The pre-release SQLite schema moves to version 4 and rejects older files rather than migrating them implicitly.

**The runtime route is fixed and the selected model value is opaque.** `xiaowei-custom` is one protocol route whose outer model id is the custom-record id. `session.models` lists only active rows owned by that session's owner. `session.selectModel` checks the same owner and active state, does not persist the selection as a Host-wide default, and `session.prompt` repeats the check before accepting work. Dispatch resolves the record again through `sessionId → ownerId → resolveCustom()`, builds one explicit pi-ai profile from the stored endpoint, protocol, upstream model, and key, and never falls back to environment credentials or enters the wallet path.

**Remote Settings uses a separate account surface.** Loopback keeps the existing Host editor and DeepSeek onboarding. A remote connection registers `AccountModelsSection`, which calls only the account custom-model RPCs, accepts a write-only password input, clears the key after success or cancel, and confirms deletion. The client redacts the create key before outgoing envelopes reach diagnostic observers, while the unmodified request still reaches the authenticated carrier.

**Custom endpoints are public HTTPS only.** Creation rejects credentials and fragments in the URL plus obvious loopback and private literals. Dispatch resolves the hostname on every request and rejects private, loopback, link-local, metadata, reserved, and non-public addresses; deployments may further constrain exact hostnames with `customModelAllowedHosts`. Private-network models require a separate deployment policy and are not part of this capability.

## Consequences

Storage tests cover encrypted bytes, reopen-and-decrypt, metadata-only listing, ownership, revocation, quota, and invalid input. API tests cover authenticated principal derivation and local-principal rejection. Session tests cover owner-filtered directory rows, selection rejection, non-global defaults, and prompt refusal after revocation. Runtime tests prove the stored endpoint/model/key reach a custom request without wallet reservation, and the remote component test covers create, secret clearing, and confirmed removal.

## Alternatives considered

- **Expose `settings.*`, `credentials.*`, and `llm.*` remotely** — rejected because those methods mutate deployment-wide Host state and are intentionally loopback-only.
- **Create one provider route per account model** — rejected because the LLM registry is Host-wide; account ids or secrets would leak into shared topology and route names.
- **Store the upstream model id directly as the session selection** — rejected because two accounts may use the same id with different endpoints and keys; the opaque record id keeps ownership authoritative at every read.
- **Allow private endpoints by default** — rejected because a remotely supplied base URL would become an SSRF path into the deployment network.
