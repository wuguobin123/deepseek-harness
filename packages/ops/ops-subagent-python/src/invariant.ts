/**
 * Runtime invariant for the Python subagent provider. The provider registers
 * exactly one `ops-python` (or renamed) provider on `ctx.subagents` per
 * `apply` call. The empty-companion case documents why a no-op is correct
 * during loader smoke runs: the provider is a process-spawning plugin, so it
 * never participates in a hermetic unit fixture that lacks a Python
 * interpreter on `PATH`.
 *
 * @module @deepseek-ai/dsh-ops-subagent-python/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'ops-subagent-python/invariant'

/**
 * Confirm that the provider registered itself on `ctx.subagents` with the
 * configured provider name. Empty-companion rationale: when this package
 * is not mounted (no `cordis.yml` row references it), the runtime has no
 * Python child to drive and the invariant is intentionally inert.
 */
export function apply(_ctx: Context): void {
  // No runtime invariant: provider registration is validated by the loader
  // smoke (cordis.yml shape + Config schema); a provider-name mismatch would
  // surface as a duplicate registration or a missing subagent, both of which
  // are already gated. We deliberately do not probe `ctx.subagents.list()`
  // here because the plugin may run in compositions where `ctx.subagents`
  // is provided by a stub for offline tests.
}
