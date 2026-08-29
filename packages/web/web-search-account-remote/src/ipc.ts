import type { WebSearchResult, WebSearchRequest } from '@deepseek-ai/dsh-web'

export type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** Device-to-parent search request. It deliberately contains no identity or credential fields. */
export interface AccountSearchStart { readonly type: 'xiaowei/web-search/start'; readonly requestId: string; readonly request: WebSearchRequest }
/** Cancellation for one in-flight search. */
export interface AccountSearchCancel { readonly type: 'xiaowei/web-search/cancel'; readonly requestId: string }
/** Parent-to-device successful search result. */
export interface AccountSearchResult { readonly type: 'xiaowei/web-search/result'; readonly requestId: string; readonly result: WebSearchResult }
/** Parent-to-device search failure. */
export interface AccountSearchError { readonly type: 'xiaowei/web-search/error'; readonly requestId: string; readonly error: { readonly code: string; readonly message: string } }
export type AccountSearchMessage = AccountSearchStart | AccountSearchCancel | AccountSearchResult | AccountSearchError

const types = new Set(['xiaowei/web-search/start', 'xiaowei/web-search/cancel', 'xiaowei/web-search/result', 'xiaowei/web-search/error'])
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('IPC message must be an object')
  return value as Record<string, unknown>
}
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`IPC ${field} must be a non-empty string`)
  return value
}
const exact = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`IPC field is not allowed: ${key}`)
}

/** Return whether a process message claims the account-search IPC namespace. */
export function isAccountSearchMessage(value: unknown): boolean {
  let input = value
  if (typeof input === 'string') {
    try { input = JSON.parse(input) as unknown } catch { return false }
  }
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    && typeof (input as Record<string, unknown>).type === 'string'
    && ((input as Record<string, unknown>).type as string).startsWith('xiaowei/web-search/')
}

/** Parse and strictly validate an untrusted parent/child message. */
export function parseAccountSearchMessage(value: unknown): AccountSearchMessage {
  if (typeof value === 'string') {
    try { return parseAccountSearchMessage(JSON.parse(value) as unknown) } catch (error) { throw new Error(`IPC message is not valid JSON: ${String(error)}`) }
  }
  const input = record(value)
  const type = text(input.type, 'type')
  if (!types.has(type)) throw new Error(`IPC message type is not supported: ${type}`)
  const requestId = text(input.requestId, 'requestId')
  if (type === 'xiaowei/web-search/start') {
    exact(input, ['type', 'requestId', 'request'])
    const request = record(input.request)
    exact(request, ['query', 'maxResults'])
    if (typeof request.query !== 'string' || request.query.length === 0 || request.query.length > 4096) throw new Error('IPC query must contain 1 to 4096 characters')
    if (request.maxResults !== undefined && (!Number.isInteger(request.maxResults) || (request.maxResults as number) < 1 || (request.maxResults as number) > 100)) throw new Error('IPC maxResults must be an integer from 1 to 100')
    return { type: 'xiaowei/web-search/start', requestId, request: request as unknown as WebSearchRequest }
  }
  if (type === 'xiaowei/web-search/cancel') { exact(input, ['type', 'requestId']); return { type: 'xiaowei/web-search/cancel', requestId } }
  if (type === 'xiaowei/web-search/result') {
    exact(input, ['type', 'requestId', 'result'])
    const result = record(input.result)
    exact(result, ['content', 'sources', 'truncated'])
    if (result.content !== undefined && typeof result.content !== 'string') throw new Error('IPC result content must be a string')
    if (!Array.isArray(result.sources)) throw new Error('IPC result sources must be an array')
    const sources = result.sources.map((source, index) => {
      const item = record(source)
      exact(item, ['url', 'title', 'snippet', 'publishedAt'])
      const parsed = { url: text(item.url, `sources[${index}].url`) } as {
        url: string
        title?: string
        snippet?: string
        publishedAt?: string
      }
      for (const field of ['title', 'snippet', 'publishedAt'] as const) {
        if (item[field] !== undefined) parsed[field] = text(item[field], `sources[${index}].${field}`)
      }
      return parsed
    })
    if (typeof result.truncated !== 'boolean') throw new Error('IPC result truncated must be a boolean')
    return {
      type: 'xiaowei/web-search/result', requestId,
      result: { ...(result.content === undefined ? {} : { content: result.content }), sources, truncated: result.truncated },
    }
  }
  exact(input, ['type', 'requestId', 'error']); const error = record(input.error); exact(error, ['code', 'message'])
  return { type: 'xiaowei/web-search/error', requestId, error: { code: text(error.code, 'code'), message: text(error.message, 'message') } }
}

/** Serialize a validated message for Node IPC. */
export function serializeAccountSearchMessage(message: AccountSearchMessage): string {
  return JSON.stringify(parseAccountSearchMessage(JSON.parse(JSON.stringify(message)) as unknown))
}
