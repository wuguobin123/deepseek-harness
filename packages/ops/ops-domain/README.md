# @deepseek-ai/dsh-ops-domain

English | [中文](README.zh.md)

Phase 1 skeleton for the ops product group's TypeScript domain mirror. The actual business domain models (Pydantic types, state machines, version-aware approvals) live in the Python peer behind [`@deepseek-ai/dsh-ops-subagent-python`](../ops-subagent-python/README.md).

This package reserves the `ctx.opsDomain` surface so a future TS consumer can read snapshot types or attach projection units without waiting for a Python round-trip. Today the plugin is a no-op; scenario接入 happens one scenario at a time and lands here together with its Python peer and a contract test.

## Plugin

Function plugin with no `inject` and no runtime state. Mount it through a `cordis.patch.yml` row when the first scenario that needs a TS-side mirror is接入ed.

## Config

Empty. Config lands with the first TS-side scenario.

## Model Experience

None, as the current skeleton registers no service, event, prompt, or tool.

#### KV Cache effect

None. Mounting the skeleton does not change the request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — `ctx.opsDomain` is reserved but not registered. No bulk migration of my-agents `operations_*` is planned; scenarios enter one at a time through [`docs/ops/scenario-integration-contract.md`](../../../docs/ops/scenario-integration-contract.md).
- **No TS-side validation** — domain integrity is owned by the Python peer. A future TS consumer must not attempt to validate Python models in TS.
