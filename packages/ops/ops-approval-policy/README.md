# @deepseek-ai/dsh-ops-approval-policy

English | [中文](README.zh.md)

Phase 1 skeleton that extends `@deepseek-ai/dsh-interaction-user-approval` with the four scenario-side fields the ops product binds to a granted approval:

- `risk` — `R1` / `R2` / `R3` tier declared by a capability manifest. The grant is bound to the tier, not to the underlying tool surface, so a downgrade of the tier invalidates outstanding grants.
- `executionVersion` — preset sha captured at grant time. The grant is bound to the exact preset revision it was authored against; a preset bump invalidates outstanding grants.
- `validForSeconds` — TTL of the grant. `0` means per-call only: the grant must not be reused for a later invocation, even with identical arguments.
- `argumentsHash` — canonical-JSON hash of the request arguments. A grant is reusable only while the incoming argument hash matches the one captured at grant time.

Today the package ships a skeleton only — `ctx.userApproval` is unchanged, and the policy resolver that consumes these fields lands with the first scenario that needs it. The skeleton reserves the surface so other ops packages can compile against the field names while the resolver is still being designed.

## Plugin

Function plugin with `inject: ['userApproval']`. Mount it through a `cordis.patch.yml` row when the first ops scenario needs the policy resolver.

## Config

Empty. Config lands with the first scenario that drives the resolver.

## Model Experience

None, as the current skeleton registers no service, event, prompt, or tool.

#### KV Cache effect

None. Mounting the skeleton does not change the request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — the policy resolver lands with the first scenario; today `ctx.userApproval` is unchanged.
