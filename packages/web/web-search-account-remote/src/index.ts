import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { AccountRemoteSearchProvider } from './provider.ts'

/** Cordis plugin name. */
export const name = 'web-search-account-remote'
export const inject = ['web']
/** Register the device-to-parent account search provider. */
export function apply(ctx: Context): void { ctx.web.registerSearchProvider(new AccountRemoteSearchProvider()) }
export { AccountRemoteSearchProvider, ACCOUNT_REMOTE_PROVIDER_ID } from './provider.ts'
export * from './ipc.ts'
