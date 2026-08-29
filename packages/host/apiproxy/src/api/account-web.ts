import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Normalized web search result, mirrored locally to keep the api package browser-safe. */
export interface WebSearchResult {
  readonly content?: string
  readonly sources: readonly { readonly url: string; readonly title?: string; readonly snippet?: string; readonly publishedAt?: string }[]
  readonly truncated: boolean
}

/** Account-owned web search API. Authentication is supplied by the carrier principal. */
export interface AccountWebApi {
  search(request: RpcRequest<{ query: string; maxResults?: number }>, signal?: AbortSignal): Promise<RpcResponse<WebSearchResult>>
}
