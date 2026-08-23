/**
 * Small validation helpers shared by the Python subagent provider's Config
 * apply step. Kept in their own module so the provider file documents the
 * service contract without intermingling load-time arg validation.
 *
 * @module @deepseek-ai/dsh-ops-subagent-python/helpers
 */

/**
 * Assert that a configuration numeric value is a positive safe integer.
 * Mirrors the same check used by `subagent-dsh-sdk` to keep timeout and
 * grace-field contract uniform across providers.
 *
 * @param providerName - the provider id, used in the thrown error message
 * @param field - the config field name
 * @param value - the value to validate
 */
export function assertPositiveFinite(providerName: string, field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${providerName} ${field} must be a positive safe integer (got ${value})`)
  }
}
