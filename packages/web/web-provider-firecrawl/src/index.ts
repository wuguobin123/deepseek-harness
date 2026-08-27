/**
 * `@deepseek-ai/dsh-web-provider-firecrawl`: registers Firecrawl-backed search
 * and fetch providers with `ctx.web`.
 * @module @deepseek-ai/dsh-web-provider-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  FirecrawlProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_FETCH_BODY_CHARS,
  FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
  FIRECRAWL_DEFAULT_MAX_SEARCH_CONTENT_CHARS,
} from './provider.ts'

export {
  FirecrawlProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_FETCH_BODY_CHARS,
  FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
  FIRECRAWL_DEFAULT_MAX_SEARCH_CONTENT_CHARS,
  FIRECRAWL_PROVIDER_ID,
  mapFirecrawlSearchResponse,
} from './provider.ts'
export type { FirecrawlProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-provider-firecrawl'

/** Capability service used for provider registration. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'FIRECRAWL_API_KEY'
const BASE_URL_ENV = 'FIRECRAWL_API_URL'

/** Plugin config; `apply` fills environment and constant defaults. */
export interface Config {
  /** Optional literal API key. Prefer `apiKeyEnv` in persisted config. */
  readonly apiKey?: string
  /** Credential reference resolved once per request. */
  readonly apiKeyEnv?: string
  /** Hosted HTTPS or loopback HTTP Firecrawl v2 endpoint. */
  readonly baseURL?: string
  /** Maximum accepted API response bytes. */
  readonly maxResponseBytes?: number
  /** Aggregate Markdown characters retained across search sources. */
  readonly maxSearchContentChars?: number
  /** Maximum Markdown characters retained from one scrape. */
  readonly maxFetchBodyChars?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  maxResponseBytes: z.number().step(1).min(1),
  maxSearchContentChars: z.number().step(1).min(1),
  maxFetchBodyChars: z.number().step(1).min(1),
})

/** Register one Firecrawl instance in both web provider registries. */
export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  const ref = credentialRef(apiKeyEnv)
  const launchEnvironment = launchEnvironmentOf(ctx)
  const provider = new FirecrawlProvider({
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
    apiKeyEnv: ref,
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(ref))?.value
      return launchEnvironment.get(apiKeyEnv)?.value
    },
    baseURL: config.baseURL ?? launchEnvironment.get(BASE_URL_ENV)?.value ?? FIRECRAWL_DEFAULT_BASE_URL,
    maxResponseBytes: config.maxResponseBytes ?? FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES,
    maxSearchContentChars: config.maxSearchContentChars ?? FIRECRAWL_DEFAULT_MAX_SEARCH_CONTENT_CHARS,
    maxFetchBodyChars: config.maxFetchBodyChars ?? FIRECRAWL_DEFAULT_MAX_FETCH_BODY_CHARS,
  })
  ctx.web.registerSearchProvider(provider)
  ctx.web.registerFetchProvider(provider)
}
