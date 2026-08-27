/**
 * `@deepseek-ai/dsh-web-search-searxng`: registers a self-hosted SearXNG
 * `WebSearchProvider` with `ctx.web`. SearXNG exposes an anonymous JSON API, so
 * this provider owns endpoint validation and response normalization but no
 * credential lifecycle.
 *
 * @module @deepseek-ai/dsh-web-search-searxng
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  SearxngSearchProvider,
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_MAX_RESPONSE_BYTES,
} from './provider.ts'

export {
  SearxngSearchProvider,
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_MAX_RESPONSE_BYTES,
  SEARXNG_PROVIDER_ID,
  mapSearxngResponse,
} from './provider.ts'
export type { SearxngSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config; `apply` fills environment and constant defaults. */
export interface Config {
  /** SearXNG origin or subpath. HTTP is accepted only on a loopback host. */
  baseURL?: string
  /** Maximum JSON response body size accepted from SearXNG. */
  maxResponseBytes?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  maxResponseBytes: z.number().step(1).min(1),
})

/** Register the SearXNG search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new SearxngSearchProvider({
    baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get('SEARXNG_BASE_URL')?.value ?? SEARXNG_DEFAULT_BASE_URL,
    maxResponseBytes: config.maxResponseBytes ?? SEARXNG_DEFAULT_MAX_RESPONSE_BYTES,
  }))
}
