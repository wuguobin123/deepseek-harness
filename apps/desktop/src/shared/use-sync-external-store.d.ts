/**
 * Ambient declaration for the untyped `use-sync-external-store` shim.
 * The package ships JS without type declarations for the
 * `/shim/with-selector.js` subpath, which is imported by
 * `@deepseek-ai/dsh-client-ui-renderer`. Without this shim the
 * renderer project fails tsc with TS7016. The shim is only used at
 * the type level; runtime resolution is unchanged.
 */
declare module 'use-sync-external-store/shim/with-selector.js' {
  import type { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector'
  export = useSyncExternalStoreWithSelector
}

declare module 'use-sync-external-store/shim/with-selector' {
  import type { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector'
  export = useSyncExternalStoreWithSelector
}
