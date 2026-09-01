/** HTTPS business connector with a deployment-owned host and credential allowlist. */

import type { Context } from '@deepseek-ai/cordis'
import type { BusinessConnector, ConnectorRequest } from '@deepseek-ai/dsh-business-connector'
import z from '@deepseek-ai/schemastery'

/** HTTPS connector policy installed once by the platform. */
export interface Config {
  /** Exact host names, without scheme or path, that manifests may target. */
  hosts: string[]
  /** Credential references that business manifests may select. */
  credentialRefs?: string[]
  /** Request deadline in milliseconds. */
  timeoutMs?: number
  /** Maximum response body size. */
  maxResponseBytes?: number
  /** Number of retries for transient network and gateway failures. */
  retries?: number
}

/** Runtime validation for the deployment policy. */
export const Config: z<Config> = z.object({
  hosts: z.array(z.string()).required(),
  credentialRefs: z.array(z.string()).default([]),
  timeoutMs: z.number().min(1).default(10_000),
  maxResponseBytes: z.number().min(1).default(1024 * 1024),
  retries: z.number().step(1).min(0).max(5).default(2),
})

/** Required connector registry. */
export const inject = ['businessConnectors']

/** Connector bound to one manifest-provided HTTPS base URL after policy validation. */
export class HttpConnector implements BusinessConnector {
  readonly allowedCredentialRefs: ReadonlySet<string>

  constructor(
    readonly id: string,
    private readonly config: {
      readonly timeoutMs: number
      readonly maxResponseBytes: number
      readonly credentialRefs: readonly string[]
      readonly retries?: number
    },
  ) {
    this.allowedCredentialRefs = new Set(config.credentialRefs)
  }

  /** Execute one GET while forwarding only Host-derived identity headers. */
  async execute(request: ConnectorRequest): Promise<unknown> {
    const { operation, input, principal, credential, signal } = request
    const base = new URL(this.id)
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
    base.pathname = basePath
    const target = new URL(operation.path.replace(/^\/+/, ''), base)
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new Error('relative path escapes approved base')
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('business GET input must be an object')
    }
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`business GET input ${key} must be a scalar`)
      }
      target.searchParams.append(key, String(value))
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-xiaowei-user-id': principal.userId,
      'x-xiaowei-required-permission': operation.permission,
    }
    if (principal.tenantId !== undefined) headers['x-xiaowei-tenant-id'] = principal.tenantId
    if (credential !== undefined) headers.authorization = `Bearer ${credential}`
    if (request.traceId !== undefined) headers['x-xiaowei-trace-id'] = request.traceId
    const retryable = (status: number): boolean => status === 429 || status === 502 || status === 503 || status === 504
    let attempt = 0
    while (true) {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort(new Error('business connector timed out')) }, this.config.timeoutMs)
      const externalAbort = (): void => { controller.abort(signal?.reason) }
      signal?.addEventListener('abort', externalAbort, { once: true })
      let response: Response
      try {
        response = await fetch(target, { method: 'GET', headers, redirect: 'error', signal: controller.signal })
      } catch (error) {
        if (attempt < (this.config.retries ?? 2) && signal?.aborted !== true) {
          attempt++
          continue
        }
        throw error
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', externalAbort)
      }
      if (!response.ok) {
        if (retryable(response.status) && attempt < (this.config.retries ?? 2)) {
          attempt++
          continue
        }
        throw new Error(`business connector HTTP ${response.status}`)
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > this.config.maxResponseBytes) {
        throw new Error('business connector response exceeds byte limit')
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch {
        throw new Error('business connector response is not JSON')
      }
    }
  }
}

/** Register a resolver that accepts only configured HTTPS hosts. */
export function apply(ctx: Context, config: Config): void {
  const hosts = new Set(config.hosts.map(host => host.toLowerCase()))
  if (hosts.size === 0) throw new Error('business connector host allowlist must not be empty')
  const timeoutMs = config.timeoutMs ?? 10_000
  const maxResponseBytes = config.maxResponseBytes ?? 1024 * 1024
  ctx.businessConnectors.registerResolver((id) => {
    let url: URL
    try {
      url = new URL(id)
    } catch {
      return undefined
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return undefined
    if (!hosts.has(url.hostname.toLowerCase())) return undefined
    return new HttpConnector(id, { timeoutMs, maxResponseBytes, credentialRefs: config.credentialRefs ?? [], retries: config.retries ?? 2 })
  })
}
