import type { Context } from '@deepseek-ai/cordis'

/**
 * Mount account plugins only in a cloud composition. The dynamic import is
 * intentionally behind the service-presence check so device bundles can omit
 * the optional account provider entirely.
 * @param ctx - agent context receiving the selected account plugins.
 * @param input - provider mount input.
 * @param enabled - whether the cloud account-plugin service is mounted.
 */
export async function mountAccountPluginsIfConfigured(
  ctx: Context,
  input: { userId: string; pluginIds?: readonly string[]; events?: readonly unknown[] },
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  const { mountAccountPlugins } = await import('@deepseek-ai/dsh-account-api-provider')
  await mountAccountPlugins(ctx, input as never)
}
