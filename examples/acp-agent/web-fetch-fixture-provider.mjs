/**
 * Snapshot-only `http` provider wrapper. It keeps the production provider's
 * decoding, bounds, redirect, and result behavior while routing the fixed
 * fixture URL to the loopback server through constructor-injected test seams.
 * Production composition never loads this module or permits loopback fetches.
 */
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'

/** Cordis plugin name. */
export const name = 'web-fetch-fixture-provider'

/** Capability service used for fixture-provider registration. */
export const inject = ['web']

/** Register the deterministic provider used only by the web-fetch snapshot. */
export function apply(ctx) {
  const provider = new HttpFetchProvider({
    maxUrlLength: 2048,
    maxResponseBytes: 5_000_000,
    maxBodyChars: 100_000,
    timeoutMs: 30_000,
    maxRedirects: 5,
    maxAttempts: 3,
    userAgent: 'deepseek-harness-snapshot/1.0',
  }, {
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, init) => {
      const target = new URL(url)
      target.hostname = '127.0.0.1'
      target.protocol = 'http:'
      target.port = '43117'
      return await fetch(target, init)
    },
  })
  ctx.web.registerFetchProvider(provider)
}
