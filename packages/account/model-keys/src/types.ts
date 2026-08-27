/**
 * Public types for the user-model-key seam.
 *
 * Key shape:
 *   - `keyId` is `mk_` + 16 hex characters; the opaque row PK.
 *   - The upstream bearer is encrypted and is never part of public views.
 *
 * @module @deepseek-ai/dsh-account-model-keys/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { UserId } from '@deepseek-ai/dsh-account-identity'

export type { UserId } from '@deepseek-ai/dsh-account-identity'

/** Opaque row PK; visible in `list()` output. */
export type KeyId = Branded<'KeyId'>

/** Internal bearer-style secret used only by the model consumer. */
export type KeyValue = Branded<'KeyValue'>
/** Opaque custom-model row id. */
export type CustomModelId = Branded<'CustomModelId'>

/** Public custom model metadata; never contains the upstream key. */
export interface CustomModelView {
  readonly customModelId: CustomModelId
  readonly userId: UserId
  readonly label: string
  readonly api: 'openai-completions' | 'openai-responses'
  readonly baseURL: string
  readonly upstreamModel: string
  readonly created: number
  readonly revoked: number | null
}

/** Internal resolved custom model, including its decrypted key. */
export interface ResolvedCustomModel extends CustomModelView {
  readonly apiKey: KeyValue
}

/** Metadata returned by ensure/provision; never contains an upstream secret. */
export interface ProvisionedKey {
  readonly keyId: KeyId
  readonly userId: UserId
  readonly label: string
  readonly createdAt: number
  readonly providerRoute: string
  readonly model: string
}

/** Internal model credential resolved for a model request. */
export interface ActiveModelCredential {
  readonly keyId: KeyId
  readonly token: KeyValue
  readonly route: string
  readonly apiBaseUrl: string
  readonly model: string
  readonly inputPriceMicrosPerToken: number
  readonly outputPriceMicrosPerToken: number
}

/** What `list()` returns; never includes the plaintext. */
export interface ModelKeyView {
  readonly keyId: KeyId
  readonly userId: UserId
  readonly label: string
  readonly createdAt: number
  readonly lastUsedAt: number | null
  readonly revokedAt: number | null
  readonly providerRoute: string
  readonly apiBaseUrl: string
  readonly model: string
  readonly inputPriceMicrosPerToken: number
  readonly outputPriceMicrosPerToken: number
}
