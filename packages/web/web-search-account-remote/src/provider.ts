import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { isAccountSearchMessage, parseAccountSearchMessage, serializeAccountSearchMessage, type AccountSearchMessage, type AccountSearchStart } from './ipc.ts'

/** Stable provider id selected by the Xiaowei local host. */
export const ACCOUNT_REMOTE_PROVIDER_ID = 'account-remote'

interface Pending {
  readonly requestId: string
  readonly resolve: (result: WebSearchResult) => void
  readonly reject: (error: Error) => void
  readonly cleanup: () => void
}
const pending = new Map<string, Pending>()
let installed = false

function fail(error: Error): void { for (const item of pending.values()) { item.cleanup(); item.reject(error) } pending.clear() }
function install(): void {
  if (installed) return
  installed = true
  if (typeof process.on !== 'function') return
  process.on('message', (value: unknown) => {
    if (!isAccountSearchMessage(value)) return
    let message: AccountSearchMessage
    try { message = parseAccountSearchMessage(value) } catch (error) { fail(new WebError(`account search IPC protocol failed: ${String(error)}`, 'WEB_IPC_ERROR')); return }
    if (message.type === 'xiaowei/web-search/start' || message.type === 'xiaowei/web-search/cancel') return
    const item = pending.get(message.requestId)
    if (item === undefined) { fail(new WebError('account search IPC response was routed to an unknown request', 'WEB_IPC_ERROR')); return }
    pending.delete(message.requestId)
    item.cleanup()
    if (message.type === 'xiaowei/web-search/result') item.resolve(message.result)
    else item.reject(new WebError(message.error.message, message.error.code))
  })
  process.once('disconnect', () => {
    fail(new WebError('account search IPC parent disconnected', 'WEB_IPC_UNAVAILABLE'))
  })
}

/** Search provider forwarding only query, maxResults, and requestId to the trusted parent. */
export class AccountRemoteSearchProvider implements WebSearchProvider {
  readonly id = ACCOUNT_REMOTE_PROVIDER_ID
  available(): boolean { return typeof process.send === 'function' && process.connected }
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) return Promise.reject(new WebError('account search IPC is unavailable', 'WEB_IPC_UNAVAILABLE'))
    if (signal?.aborted) return Promise.reject(new WebError('account search aborted', 'WEB_ABORTED', { cause: signal.reason }))
    install()
    const send = process.send?.bind(process)
    if (send === undefined) return Promise.reject(new WebError('account search IPC is unavailable', 'WEB_IPC_UNAVAILABLE'))
    const start: AccountSearchStart = { type: 'xiaowei/web-search/start', requestId: crypto.randomUUID(), request }
    return new Promise<WebSearchResult>((resolve, reject) => {
      const cancel = (): void => {
        if (!pending.delete(start.requestId)) return
        try { send(serializeAccountSearchMessage({ type: 'xiaowei/web-search/cancel', requestId: start.requestId })) } catch { /* parent disappeared; rejection below is authoritative */ }
        reject(new WebError('account search aborted', 'WEB_ABORTED', { cause: signal?.reason }))
      }
      const item: Pending = { requestId: start.requestId, resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel) }
      pending.set(start.requestId, item)
      signal?.addEventListener('abort', cancel, { once: true })
      try { send(serializeAccountSearchMessage(start)) } catch (error) { pending.delete(start.requestId); signal?.removeEventListener('abort', cancel); reject(new WebError(`account search IPC failed: ${String(error)}`, 'WEB_IPC_ERROR', { cause: error })) }
    })
  }
}
