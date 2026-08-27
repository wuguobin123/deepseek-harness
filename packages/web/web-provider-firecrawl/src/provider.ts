/**
 * Firecrawl REST provider for the web capability seam.
 * @module @deepseek-ai/dsh-web-provider-firecrawl/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  WebError,
  type WebFetchProvider,
  type WebFetchRequest,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Provider identifier used by web search and fetch selection. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Hosted Firecrawl v2 REST endpoint. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v2'

/** Maximum accepted Firecrawl JSON response size. */
export const FIRECRAWL_DEFAULT_MAX_RESPONSE_BYTES = 5_000_000

/** Aggregate Markdown characters retained across one search response. */
export const FIRECRAWL_DEFAULT_MAX_SEARCH_CONTENT_CHARS = 20_000

/** Maximum Markdown characters retained from one scrape. */
export const FIRECRAWL_DEFAULT_MAX_FETCH_BODY_CHARS = 100_000

const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options after plugin defaults are applied. */
export interface FirecrawlProviderOptions {
  /** Literal secret used ahead of the credential service, when configured. */
  readonly apiKey?: string
  /** Resolve a fresh secret for each request. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference included in missing-credential diagnostics. */
  readonly apiKeyEnv?: CredentialRef
  /** Hosted HTTPS or loopback HTTP Firecrawl v2 endpoint. */
  readonly baseURL: string
  /** Maximum accepted API response bytes. */
  readonly maxResponseBytes: number
  /** Aggregate Markdown characters retained across search sources. */
  readonly maxSearchContentChars: number
  /** Maximum Markdown characters retained from a scrape. */
  readonly maxFetchBodyChars: number
}

interface FirecrawlSearchItem {
  readonly url: string
  readonly title?: string
  readonly description?: string
  readonly markdown?: string
}

interface FirecrawlScrapeData {
  readonly markdown: string
  readonly metadata?: {
    readonly sourceURL?: string
    readonly statusCode?: number
  }
}

/** Firecrawl-backed implementation of both web search and web fetch. */
export class FirecrawlProvider implements WebSearchProvider, WebFetchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlProviderOptions) {}

  available(): boolean {
    return isAllowedBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.maxResponseBytes)
      && isPositiveInteger(this.options.maxSearchContentChars)
      && isPositiveInteger(this.options.maxFetchBodyChars)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfAborted(signal)
    const key = await this.resolveKey()
    const payload = await this.request('/search', {
      query: request.query,
      ...(request.maxResults === undefined ? {} : { limit: request.maxResults }),
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    }, key, signal)
    return mapFirecrawlSearchResponse(payload, this.options.maxSearchContentChars)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    throwIfAborted(signal)
    const target = validateTarget(request.url)
    const key = await this.resolveKey()
    const payload = await this.request('/scrape', {
      url: target.toString(),
      formats: ['markdown'],
      onlyMainContent: true,
    }, key, signal)
    const data = parseScrapeResponse(payload)
    const content = data.markdown.slice(0, this.options.maxFetchBodyChars)
    const finalUrl = resolveFinalUrl(target, data.metadata?.sourceURL)
    return {
      url: finalUrl,
      statusCode: data.metadata?.statusCode ?? 200,
      body: { kind: 'text', content },
      truncated: content.length < data.markdown.length,
    }
  }

  private async resolveKey(): Promise<string> {
    const literal = this.options.apiKey?.trim()
    const key = literal !== undefined && literal.length > 0
      ? literal
      : (await this.options.resolveApiKey?.())?.trim()
    if (key === undefined || key.length === 0) {
      const suffix = this.options.apiKeyEnv === undefined ? '' : ` (${this.options.apiKeyEnv})`
      throw new WebError(`Firecrawl API key is missing${suffix}`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    return key
  }

  private async request(path: string, body: unknown, key: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${stripTrailingSlash(this.options.baseURL)}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`Firecrawl request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    let bytes: Uint8Array
    try {
      bytes = await readCapped(response, this.options.maxResponseBytes, signal)
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Firecrawl response body could not be read: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      throw new WebError(`Firecrawl API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch (error: unknown) {
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/**
 * Validate and normalize one Firecrawl v2 search response.
 * @param value - Parsed external JSON returned by `POST /search`.
 * @param maxContentChars - Aggregate Markdown character cap across sources.
 * @returns Provider-neutral, citeable search sources.
 */
export function mapFirecrawlSearchResponse(value: unknown, maxContentChars: number): WebSearchResult {
  const items = parseSearchResponse(value)
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  let remaining = maxContentChars
  for (const item of items) {
    if (!isSafeSourceUrl(item.url) || seen.has(item.url)) continue
    seen.add(item.url)
    const candidate = item.markdown ?? item.description
    const snippet = candidate === undefined ? undefined : candidate.slice(0, remaining)
    remaining -= snippet?.length ?? 0
    sources.push({
      url: item.url,
      ...(item.title !== undefined && item.title.length > 0 ? { title: item.title } : {}),
      ...(snippet !== undefined && snippet.length > 0 ? { snippet } : {}),
    })
  }
  return { sources, truncated: false }
}

function parseSearchResponse(value: unknown): readonly FirecrawlSearchItem[] {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data) || !Array.isArray(value.data.web)) {
    throw new WebError('Firecrawl returned an invalid search response', 'WEB_PROVIDER_ERROR')
  }
  return value.data.web.map((item: unknown) => {
    if (!isRecord(item) || typeof item.url !== 'string') {
      throw new WebError('Firecrawl search response contains an invalid result', 'WEB_PROVIDER_ERROR')
    }
    for (const key of ['title', 'description', 'markdown']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') {
        throw new WebError(`Firecrawl search result field "${key}" is not a string`, 'WEB_PROVIDER_ERROR')
      }
    }
    return {
      url: item.url,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.markdown === 'string' ? { markdown: item.markdown } : {}),
    }
  })
}

function parseScrapeResponse(value: unknown): FirecrawlScrapeData {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data) || typeof value.data.markdown !== 'string') {
    throw new WebError('Firecrawl returned an invalid scrape response', 'WEB_PROVIDER_ERROR')
  }
  let metadata: FirecrawlScrapeData['metadata']
  if (value.data.metadata !== undefined) {
    if (!isRecord(value.data.metadata)) throw new WebError('Firecrawl returned invalid scrape metadata', 'WEB_PROVIDER_ERROR')
    const sourceURL = value.data.metadata.sourceURL
    const statusCode = value.data.metadata.statusCode
    if (sourceURL !== undefined && typeof sourceURL !== 'string') throw new WebError('Firecrawl returned an invalid source URL', 'WEB_PROVIDER_ERROR')
    if (statusCode !== undefined && (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) {
      throw new WebError('Firecrawl returned an invalid status code', 'WEB_PROVIDER_ERROR')
    }
    metadata = {
      ...(typeof sourceURL === 'string' ? { sourceURL } : {}),
      ...(typeof statusCode === 'number' ? { statusCode } : {}),
    }
  }
  return { markdown: value.data.markdown, ...(metadata === undefined ? {} : { metadata }) }
}

function resolveFinalUrl(target: URL, sourceURL: string | undefined): string {
  if (sourceURL === undefined) return target.toString()
  const final = validateTarget(sourceURL)
  if (final.origin !== target.origin) {
    throw new WebError('Firecrawl reported a cross-origin final URL', 'WEB_REDIRECT_BLOCKED')
  }
  return final.toString()
}

function validateTarget(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError('invalid fetch URL', 'WEB_INVALID_URL', { cause: error })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username.length > 0 || url.password.length > 0) {
    throw new WebError('fetch URL must be HTTP(S) without embedded credentials', 'WEB_BLOCKED_URL')
  }
  if (isPrivateIpLiteral(url.hostname)) {
    throw new WebError('loopback and private IP literals are blocked', 'WEB_BLOCKED_URL')
  }
  return url
}

function isSafeSourceUrl(value: string): boolean {
  try {
    validateTarget(value)
    return true
  } catch {
    return false
  }
}

function isAllowedBaseUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}

function isPrivateIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (isLoopback(host) || /^127(?:\.\d{1,3}){3}$/u.test(host)) return true
  if (/^10(?:\.\d{1,3}){3}$/u.test(host) || /^192\.168(?:\.\d{1,3}){2}$/u.test(host)) return true
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/u.test(host)) return true
  if (/^169\.254(?:\.\d{1,3}){2}$/u.test(host)) return true
  return host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted(signal)
}

function aborted(signal?: AbortSignal, cause?: unknown): WebError {
  return new WebError('Firecrawl request aborted', 'WEB_ABORTED', { cause: signal?.reason ?? cause })
}

async function readCapped(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    await response.body?.cancel()
    throw new WebError(`Firecrawl response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new WebError(`Firecrawl response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new WebError(`Firecrawl response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
      }
      chunks.push(value)
      throwIfAborted(signal)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
