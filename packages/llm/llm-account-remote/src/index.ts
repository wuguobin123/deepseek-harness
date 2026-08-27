import type { Context } from '@deepseek-ai/cordis'
import { AccountRemoteAdapter } from './adapter.ts'

export * from './adapter.ts'
export * from './ipc.ts'

export const name = 'llm-account-remote'
export const inject = ['llm']

/** Mount the device-only MiniMax account route. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['xiaowei-minimax'], new AccountRemoteAdapter())
}
