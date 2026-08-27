/**
 * Model-key-specific error codes. The wire layer (`packages/host/apiproxy/src/api/model-keys.ts`)
 * maps these to RPC error codes so the renderer / desktop can branch without
 * reading the message string.
 *
 * `MASTER_KEY_NOT_CONFIGURED` and `MASTER_KEY_INVALID` surface as `bad-request`
 * today; a future deployment key-rotator will split them into a distinct
 * `internal` code so the renderer can prompt the operator rather than
 * re-prompting the user.
 */

export type ModelKeyErrorCode =
  | 'BAD_REQUEST'
  | 'KEY_NOT_FOUND'
  | 'MASTER_KEY_NOT_CONFIGURED'
  | 'MASTER_KEY_INVALID'
  | 'MODEL_KEYS_UNAVAILABLE'

/** Stable model-credential failure surfaced to service consumers. */
export class ModelKeyError extends Error {
  /** Machine-readable failure code. */
  readonly code: ModelKeyErrorCode
  override readonly cause?: unknown

  constructor(code: ModelKeyErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ModelKeyError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Maximum length of the human-readable label attached to a key. */
export const MAX_LABEL_LENGTH = 64
/** Maximum length of a custom-model upstream model name. */
export const MAX_CUSTOM_MODEL_LENGTH = 128
/** Maximum number of active custom models owned by one account. */
export const DEFAULT_MAX_CUSTOM_MODELS = 32
/** Length of an encrypted row's IV. NIST SP 800-38D §8.2.1 calls for 12 bytes. */
export const IV_BYTES = 12
/** Length of the AES-GCM authentication tag. */
export const TAG_BYTES = 16
/** Prefix on the row PK so an operator can grep `mk_` in logs. */
export const KEY_ID_PREFIX = 'mk_'

/** Validate one operator-visible credential label.
 * @param label Candidate label.
 * @returns Narrows the value to a valid string.
 */
export function assertLabel(label: unknown): asserts label is string {
  if (typeof label !== 'string') throw new ModelKeyError('BAD_REQUEST', 'label must be a string')
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    throw new ModelKeyError('BAD_REQUEST', `label length must be 1..${MAX_LABEL_LENGTH}`)
  }
}

/** Validate a custom model endpoint and model name.
 * @param input Candidate custom-model fields.
 * @returns Narrows the fields to their validated string and API values.
 */
export function assertCustomModelInput(input: { label: unknown; api: unknown; baseURL: unknown; upstreamModel: unknown; apiKey: unknown }): asserts input is { label: string; api: 'openai-completions' | 'openai-responses'; baseURL: string; upstreamModel: string; apiKey: string } {
  if (typeof input.label !== 'string') throw new ModelKeyError('BAD_REQUEST', 'label must be a string')
  input.label = input.label.trim()
  assertLabel(input.label)
  if (input.api !== 'openai-completions' && input.api !== 'openai-responses') throw new ModelKeyError('BAD_REQUEST', 'api must be openai-completions or openai-responses')
  if (typeof input.baseURL !== 'string' || input.baseURL.length === 0 || input.baseURL.length > 2048) throw new ModelKeyError('BAD_REQUEST', 'baseURL length is invalid')
  let url: URL
  try { url = new URL(input.baseURL) } catch { throw new ModelKeyError('BAD_REQUEST', 'baseURL must be a valid URL') }
  if (url.protocol !== 'https:') throw new ModelKeyError('BAD_REQUEST', 'baseURL must use HTTPS')
  if (url.username !== '' || url.password !== '' || url.hash !== '') throw new ModelKeyError('BAD_REQUEST', 'baseURL contains forbidden URL components')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) || host.startsWith('172.') && Number(host.split('.')[1]) >= 16 && Number(host.split('.')[1]) <= 31) throw new ModelKeyError('BAD_REQUEST', 'baseURL must not target a private or loopback host')
  if (typeof input.upstreamModel !== 'string') throw new ModelKeyError('BAD_REQUEST', 'upstreamModel must be a string')
  const upstreamModel = input.upstreamModel.trim()
  input.upstreamModel = upstreamModel
  if (upstreamModel.length === 0 || upstreamModel.length > MAX_CUSTOM_MODEL_LENGTH) throw new ModelKeyError('BAD_REQUEST', `upstreamModel length must be 1..${MAX_CUSTOM_MODEL_LENGTH}`)
  if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096) throw new ModelKeyError('BAD_REQUEST', 'apiKey is invalid')
  const normalized = input.apiKey.trim()
  if (!/^[\x21-\x7E]+$/.test(normalized)) throw new ModelKeyError('BAD_REQUEST', 'apiKey is invalid')
  input.apiKey = normalized
  input.baseURL = url.toString()
}
