/**
 * Anonymous SearXNG JSON search provider.
 * @module @deepseek-ai/dsh-web-search-searxng/provider
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Provider identifier used by `dsh-web` selection and fallback configuration. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/** Default endpoint for a locally installed SearXNG instance. */
export const SEARXNG_DEFAULT_BASE_URL = 'http://localhost:8080'

/** Default maximum response body accepted from SearXNG. */
export const SEARXNG_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options after plugin defaults are applied. */
export interface SearxngSearchProviderOptions {
  /** SearXNG origin or subpath. */
  readonly baseURL: string
  /** Maximum response body size in bytes. */
  readonly maxResponseBytes: number
}

interface SearxngResult {
  readonly url: string
  readonly title?: string
  readonly content?: string
  readonly publishedDate?: string
}

interface SearxngResponse {
  readonly results: readonly SearxngResult[]
}

/**
 * Validate and normalize one SearXNG JSON response.
 * @param value - Parsed external JSON value returned by `POST /search`.
 * @returns Provider-neutral search sources; non-HTTP(S) URLs are omitted.
 */
export function mapSearxngResponse(value: unknown): WebSearchResult {
  const response = parseSearxngResponse(value)
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const result of response.results) {
    if (!isHttpUrl(result.url) || seen.has(result.url)) continue
    seen.add(result.url)
    sources.push({
      url: result.url,
      ...(result.title !== undefined && result.title.length > 0 ? { title: result.title } : {}),
      ...(result.content !== undefined && result.content.length > 0 ? { snippet: result.content } : {}),
      ...(result.publishedDate !== undefined && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {}),
    })
  }
  return { sources, truncated: false }
}

/** SearXNG-backed search provider; HTTP redirects fail as provider errors. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  constructor(private readonly options: SearxngSearchProviderOptions) {}

  available(): boolean {
    return isAllowedBaseUrl(this.options.baseURL) && isPositiveInteger(this.options.maxResponseBytes)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (signal?.aborted) throw aborted(signal)
    let response: Response
    try {
      response = await fetch(`${stripTrailingSlash(this.options.baseURL)}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ q: request.query, format: 'json' }).toString(),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`SearXNG search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    let bytes: Uint8Array
    try {
      bytes = await readCapped(response, this.options.maxResponseBytes, signal)
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`SearXNG response body could not be read: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(`SearXNG API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    try {
      return mapSearxngResponse(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`SearXNG returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function parseSearxngResponse(value: unknown): SearxngResponse {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { results?: unknown }).results)) {
    throw new WebError('SearXNG response has an invalid results array', 'WEB_PROVIDER_ERROR')
  }
  const results: SearxngResult[] = []
  for (const item of (value as { results: unknown[] }).results) {
    if (typeof item !== 'object' || item === null) throw new WebError('SearXNG response contains an invalid result', 'WEB_PROVIDER_ERROR')
    const result = item as Record<string, unknown>
    if (typeof result.url !== 'string') throw new WebError('SearXNG result has no URL', 'WEB_PROVIDER_ERROR')
    for (const key of ['title', 'content', 'publishedDate']) {
      if (result[key] !== undefined && result[key] !== null && typeof result[key] !== 'string') {
        throw new WebError(`SearXNG result field "${key}" is not a string`, 'WEB_PROVIDER_ERROR')
      }
    }
    results.push({
      url: result.url,
      ...(typeof result.title === 'string' ? { title: result.title } : {}),
      ...(typeof result.content === 'string' ? { content: result.content } : {}),
      ...(typeof result.publishedDate === 'string' ? { publishedDate: result.publishedDate } : {}),
    })
  }
  return { results }
}

async function readCapped(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    await response.body?.cancel()
    throw new WebError(`SearXNG response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new WebError(`SearXNG response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
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
        throw new WebError(`SearXNG response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
      }
      chunks.push(value)
      if (signal?.aborted) throw aborted(signal)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

/** Validate a remote HTTPS endpoint or loopback-only HTTP endpoint. */
function isAllowedBaseUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) return false
  return url.protocol === 'https:'
    || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
}

/** True when a result URL is safe to expose as a browser source. */
function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)
}

/** Remove only trailing separators before appending the search operation. */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

/** True for a positive whole-number response cap. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/stream abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Produce the capability seam's stable cancellation error. */
function aborted(signal?: AbortSignal, cause?: unknown): WebError {
  return new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? cause })
}
