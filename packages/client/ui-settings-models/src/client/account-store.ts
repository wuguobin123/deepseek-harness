/** Remote account custom-model store. */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** RPC face used by the remote account settings section. */
export type CustomModelsApi = IApiClient['customModels']

type CustomModelsListResponse = Awaited<ReturnType<CustomModelsApi['list']>>
type CustomModelsListSuccess = Extract<CustomModelsListResponse['result'], { ok: true }>

/** One public custom-model metadata row. */
export type CustomModelView = CustomModelsListSuccess['value']['items'][number]

/** Load state for the remote custom-model list. */
export interface AccountModelsState {
  /** Current load phase. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Most recent terminal load failure. */
  error: string | null
  /** Last accepted account rows. */
  items: readonly CustomModelView[]
}

/** Loads account custom-model metadata and prevents stale responses from winning. */
export class AccountModelsStore {
  /** Observable page state. */
  readonly store: SnapshotStore<AccountModelsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    items: [],
  })

  private generation = 0

  /** @param api - authenticated account custom-model RPC face. */
  constructor(private readonly api: { customModels: CustomModelsApi }) {}

  /** Load the current account's custom-model metadata. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const response = await this.api.customModels.list({})
      const result = response.result
      if (!result.ok) throw new Error(result.error.message)
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.items = result.value.items
      })
    } catch (error: unknown) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }
}
