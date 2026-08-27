/** Stable failures raised by the account plugin factory. */
export type PluginFactoryErrorCode = 'PLUGIN_NOT_FOUND' | 'PLUGIN_DEFAULT' | 'PLUGIN_FACTORY_UNAVAILABLE'

/** Domain error with a machine-readable code. */
export class PluginFactoryError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: PluginFactoryErrorCode
  constructor(code: PluginFactoryErrorCode, message: string) {
    super(message)
    this.name = 'PluginFactoryError'
    this.code = code
  }
}
