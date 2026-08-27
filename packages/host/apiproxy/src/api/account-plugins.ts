import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Client-safe wire projection of one account plugin catalog entry. */
export interface AccountPluginView {
  pluginId: string
  title: string
  description: string
  version: string
  systemDefault: boolean
  installed: boolean
}

/** Account-owned view of the server-registered plugin catalog. */
export interface AccountPluginsApi {
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: AccountPluginView[] }>>
  install(request: RpcRequest<{ pluginId: string }>): Promise<RpcResponse<AccountPluginView>>
  uninstall(request: RpcRequest<{ pluginId: string }>): Promise<RpcResponse<AccountPluginView>>
}
