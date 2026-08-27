import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AccountPluginView } from '@deepseek-ai/dsh-account-api-provider'

const plugin = z.object({
  pluginId: z.string().min(1),
  title: z.string(),
  description: z.string(),
  version: z.string(),
  systemDefault: z.boolean(),
  installed: z.boolean(),
}) satisfies z.ZodType<Wire<AccountPluginView>>
/** Empty request for the authenticated account's plugin catalog. */
export const accountPluginsListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'account.plugins.list'>>>
/** Wire validation for the account plugin catalog. */
export const accountPluginsListValueSchema = z.object({ items: z.array(plugin) }) satisfies z.ZodType<Wire<ResponseValue<'account.plugins.list'>>>
/** Wire validation for an install request containing only a server catalog id. */
export const accountPluginsInstallRequestSchema = z.object({ pluginId: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'account.plugins.install'>>>
/** Wire validation for the installed public row. */
export const accountPluginsInstallValueSchema = plugin satisfies z.ZodType<Wire<ResponseValue<'account.plugins.install'>>>
/** Wire validation for an uninstall request containing only a server catalog id. */
export const accountPluginsUninstallRequestSchema = z.object({ pluginId: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'account.plugins.uninstall'>>>
/** Wire validation for the uninstalled public row. */
export const accountPluginsUninstallValueSchema = plugin satisfies z.ZodType<Wire<ResponseValue<'account.plugins.uninstall'>>>
