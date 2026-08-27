/** Cloud Host route partition gate. */

/**
 * Assert that the cloud assembly is exactly core routes plus account routes.
 * The core list is supplied by the device-safe core assembly; this module does
 * not import or execute the device Host.
 * @param coreMethods - methods owned by the device-safe core.
 * @param rpcMethods - complete cloud RpcMethodMap key set.
 */
export async function assertCloudRoutePartition(coreMethods: Iterable<string>, rpcMethods: Iterable<string>): Promise<void> {
  const { assertRoutePartition } = await import('@deepseek-ai/dsh-account-api-provider')
  assertRoutePartition(coreMethods, rpcMethods)
}
