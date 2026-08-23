# @deepseek-ai/dsh-ops-package-signing

English | [中文](README.zh.md)

Sign and verify Skill/Subagent/MCP bundles shipped through the ops product. The first signed bundle lands together with the HMAC-SHA256 verifier: the signer covers the bundle manifest plus a `PACKAGE.sig` artifact, the verifier reads both, recomputes the HMAC over the canonical manifest, and compares against the supplied signature before the bundle is admitted.

This package ships a skeleton (no-op `apply`). It reserves the `ctx.opsPackageSigning` surface so a future Skill or Subagent provider can declare signed bundles in its manifest without waiting for the verifier.

## Plugin

Function plugin with `inject: ['fs']` (the verifier will read manifest and signature artifacts) and no runtime state. Mount it through a `cordis.patch.yml` row when the first signed bundle is接入ed.

## Config

Empty. Config lands with the first signed bundle.

## Model Experience

None. The plugin registers no service and emits no event; mounting it does not change the model's request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — signing lands with the first signed bundle; `ctx.opsPackageSigning` is reserved but not registered.
- **No verifier yet** — the HMAC-SHA256 verification path is planned (manifest + `PACKAGE.sig`) but not implemented. A consumer must not attempt to verify a bundle through this package until the verifier lands.