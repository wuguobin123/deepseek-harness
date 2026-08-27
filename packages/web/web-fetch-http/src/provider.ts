/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates URLs, follows only same-origin redirects,
 * enforces time and size limits, classifies and decodes text, and leaves presentation to
 * `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies or ambient credentials.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { classifyContentType, decoderForCharset, isPublicAddress, isSameOrigin, parseCharset, validateFetchUrl } from './policy.ts'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'

/** Injectable transport seams used by tests without weakening the production policy. */
export interface HttpFetchDependencies {
  /** Resolve all A/AAAA answers for a hostname. */
  resolveAddresses?: (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>
  /** Execute a request after address validation; production uses undici. */
  request?: (url: URL, init: RequestInit) => Promise<Response>
}

/** Resolved provider limits (the plugin's schemastery Config supplies defaults). */
export interface HttpFetchLimits {
  /** Maximum accepted request URL length. */
  maxUrlLength: number
  /** Maximum response body size in bytes (read is aborted past this). */
  maxResponseBytes: number
  /** Maximum decoded body length in characters (truncated past this). */
  maxBodyChars: number
  /** Default fetch timeout in milliseconds. */
  timeoutMs: number
  /** Maximum number of (same-origin) redirect hops to follow. */
  maxRedirects: number
  /** Maximum transport attempts for one request after DNS validation. */
  maxAttempts: number
  /** `User-Agent` header sent on every request. */
  userAgent: string
}

/** Stable id this provider registers under. */
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/** The anonymous public HTTP(S) fetch provider. */
export class HttpFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID

  constructor(private readonly limits: HttpFetchLimits, private readonly dependencies: HttpFetchDependencies = {}) {}

  /** No credentials to check — an anonymous public fetcher is always usable. */
  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')

    // One signal stops both the request and body read. The deadline's TimeoutReason later
    // distinguishes this provider's timeout from caller or outer-deadline cancellation.
    using d = deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    return await this.followAndRead(request.url, d.signal)
  }

  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  private async followAndRead(initialUrl: string, signal: AbortSignal): Promise<WebFetchResult> {
    const sourceUrl = validateFetchUrl(initialUrl, this.limits.maxUrlLength)
    const githubTarget = githubContentTarget(sourceUrl)
    let currentUrl = githubTarget ?? sourceUrl
    let redirectsFollowed = 0

    for (;;) {
      const request = await this.requestOnce(currentUrl, signal)
      const response = request.response
      try {
        if (isRedirectStatus(response.status)) {
          // Enforce the redirect budget before resolving or validating the next hop.
          if (redirectsFollowed >= this.limits.maxRedirects) {
            await response.body?.cancel()
            throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
          }
          const location = response.headers.get('location')
          if (location === null) {
            // A redirect status with no Location is not a usable resource. Cancel
            // the (possibly streaming) body before throwing so no socket leaks.
            await response.body?.cancel()
            throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
          }
          // Re-validate the target against the same transport hygiene a direct request gets: a
          // redirect must not be a back door to a credentialed, non-http(s), or over-long URL
          // that validateFetchUrl would reject.
          let validatedTarget: URL
          try {
            const target = resolveRedirect(location, currentUrl)
            validatedTarget = validateFetchUrl(target.toString(), this.limits.maxUrlLength)
            if (!isSameOrigin(validatedTarget, currentUrl)) {
              throw new WebError(
                `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
                'WEB_REDIRECT_BLOCKED',
              )
            }
          } catch (error: unknown) {
            await response.body?.cancel()
            throw error
          }
          await response.body?.cancel()
          currentUrl = validatedTarget
          redirectsFollowed++
          continue
        }

        return await this.readBody(response, githubTarget === undefined ? currentUrl : sourceUrl, signal)
      } finally {
        await request.close()
      }
    }
  }

  private async requestOnce(url: URL, signal: AbortSignal): Promise<{ response: Response; close: () => Promise<void> }> {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (this.dependencies.resolveAddresses === undefined && isIpLiteral(hostname) && !isPublicAddress(hostname)) {
      throw new WebError(`URL resolves to a non-public address: ${hostname}`, 'WEB_BLOCKED_URL')
    }
    const resolve = this.dependencies.resolveAddresses ?? (async (name: string) => await dnsLookup(name, { all: true, order: 'verbatim' }))
    let answers: ReadonlyArray<{ address: string; family: number }>
    try {
      answers = await resolve(hostname)
    } catch (error: unknown) {
      throw new WebError(`web fetch DNS lookup failed for ${hostname}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (answers.length === 0 || answers.some(answer => !isPublicAddress(answer.address))) {
      throw new WebError(`URL resolves to a non-public address: ${hostname}`, 'WEB_BLOCKED_URL')
    }
    const verified = answers.map(({ address }) => ({ address, family: isIP(address) }))
    /* v8 ignore next -- public-address validation above guarantees IPv4 or IPv6 for every answer. */
    if (verified.some(answer => answer.family === 0)) {
      throw new WebError(`DNS returned an invalid address for ${hostname}`, 'WEB_PROVIDER_ERROR')
    }
    let lastError: unknown
    for (let attempt = 0; attempt < this.limits.maxAttempts; attempt++) {
      try {
        if (this.dependencies.request !== undefined) {
          return { response: await this.dependencies.request(url, {
            method: 'GET',
            redirect: 'manual',
            headers: requestHeaders(url, this.limits.userAgent),
            signal,
          }), close: async () => {} }
        }
        const offset = attempt % verified.length
        const rotated = [...verified.slice(offset), ...verified.slice(0, offset)]
        const agent = new Agent({ connect: { lookup: pinnedLookup(rotated) } })
        try {
          const response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            headers: requestHeaders(url, this.limits.userAgent),
            signal,
            dispatcher: agent,
          } as RequestInit & { dispatcher: Agent })
          return { response, close: async () => { await agent.close() } }
        } catch (error: unknown) {
          await agent.close()
          throw error
        }
      } catch (error: unknown) {
        const translated = translateAbortOrNetwork(error, signal)
        if (translated.code !== 'WEB_PROVIDER_ERROR') throw translated
        lastError = error
      }
    }
    throw translateAbortOrNetwork(lastError, signal)
  }

  /** Read, byte-cap, classify, and decode the final response body. */
  private async readBody(response: Response, finalUrl: URL, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await response.body?.cancel()
      throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    }

    // Resolve the decoder BEFORE reading the body so an unsupported charset
    // fails without consuming the stream — but cancel the body on that failure
    // so the socket does not leak (matching the unsupported-content-type path).
    let decoder: TextDecoder
    try {
      decoder = decoderForCharset(parseCharset(contentType))
    } catch (error: unknown) {
      await response.body?.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > this.limits.maxBodyChars
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded
    const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  /**
   * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
   * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
   * server that under-reports still yields a bounded usable body.
   */
  private async readCapped(response: Response, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
      }
    }

    /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }

    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = this.limits.maxResponseBytes - total
        // Only DROPPED bytes count as truncation: a chunk that exactly fills the
        // remaining capacity keeps all its bytes and we read on to observe EOF,
        // so an exactly-at-cap body is not falsely flagged truncated.
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } catch (error: unknown) {
      /* v8 ignore next -- mid-stream read fault needs a network drop after headers; translate path covered by request-phase tests. */
      throw translateAbortOrNetwork(error, signal)
    } finally {
      /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
      await reader.cancel().catch(() => {
        // Cancel after a successful read (or after we broke past the cap) is
        // best-effort cleanup; the bytes we need are already collected.
      })
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }
}

/** Build a Node-compatible lookup that returns only previously validated addresses. */
export function pinnedLookup(verified: ReadonlyArray<{ address: string; family: number }>): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) callback(null, [...verified])
    else {
      /* v8 ignore next -- requestOnce calls this helper only after rejecting an empty answer set. */
      const first = verified[0] as { address: string; family: number }
      callback(null, first.address, first.family)
    }
  }
}

/**
 * Map GitHub repository and file pages to GitHub's anonymous content endpoints.
 * These endpoints expose the same public bytes without depending on the HTML
 * frontend, which is commonly unavailable from restricted server networks.
 */
export function githubContentTarget(url: URL): URL | undefined {
  if (url.protocol !== 'https:') return undefined
  const segments = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'raw.githubusercontent.com') {
    const owner = segments[0]
    const repository = segments[1]
    const ref = segments[2]
    const path = segments.slice(3).join('/')
    if (owner === undefined || repository === undefined || ref === undefined || path === ''
      || !isGithubName(owner) || !isGithubName(repository)) return undefined
    return githubContentsTarget(owner, repository, ref, path)
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return undefined
  const owner = segments[0]
  const repositoryWithSuffix = segments[1]
  if (owner === undefined || repositoryWithSuffix === undefined
    || !isGithubName(owner) || !isGithubName(repositoryWithSuffix)) return undefined
  const repository = repositoryWithSuffix.endsWith('.git') ? repositoryWithSuffix.slice(0, -4) : repositoryWithSuffix
  if (repository === '') return undefined
  if (segments.length === 2) {
    return new URL(`https://api.github.com/repos/${owner}/${repository}/readme`)
  }
  const kind = segments[2]
  const ref = segments[3]
  const path = segments.slice(4).join('/')
  if ((kind === 'blob' || kind === 'raw') && ref !== undefined && path !== '') {
    return githubContentsTarget(owner, repository, ref, path)
  }
  return undefined
}

function githubContentsTarget(owner: string, repository: string, ref: string, path: string): URL {
  const target = new URL(`https://api.github.com/repos/${owner}/${repository}/contents/${path}`)
  target.searchParams.set('ref', ref)
  return target
}

function isGithubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

function requestHeaders(url: URL, userAgent: string): Record<string, string> {
  return {
    'user-agent': userAgent,
    'accept': url.hostname === 'api.github.com'
      ? 'application/vnd.github.raw+json'
      : 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
  }
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)
}

/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Resolve a (possibly relative) `Location` against the current URL. */
function resolveRedirect(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
    throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Translate a thrown fetch/stream error into a `WebError`, classified by the
 * deadline signal rather than the thrown value (which differs by phase: the
 * request-phase `fetch` rejects with the abort reason, while the read-phase
 * reader surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
 * recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any other
 * abort — an upstream cancel, or a foreign/outer deadline's timeout under
 * nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
 * transport/network failure (`WEB_PROVIDER_ERROR`).
 */
function translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout !== undefined) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  if (error instanceof Error && error.name === 'AbortError') return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}
