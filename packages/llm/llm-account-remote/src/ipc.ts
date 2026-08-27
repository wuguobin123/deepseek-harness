import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** Session-free request matching dsh-llm-account-inference version 1. */
export interface AccountInferenceRequest {
  readonly version: 1
  readonly model: string
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string | readonly unknown[] }[]
  readonly system?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  readonly tools?: readonly { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> }[]
}

/** JSON-safe request sent from the device worker to its trusted parent. */
export interface AccountInferenceStart {
  readonly type: 'xiaowei/inference/start'
  readonly requestId: string
  readonly request: AccountInferenceRequest
}

/** Cancellation sent to the parent for an in-flight inference request. */
export interface AccountInferenceCancel {
  readonly type: 'xiaowei/inference/cancel'
  readonly requestId: string
}

export interface AccountInferenceChunk {
  readonly type: 'xiaowei/inference/chunk'
  readonly requestId: string
  readonly chunk: StreamChunk
}

export interface AccountInferenceError {
  readonly type: 'xiaowei/inference/error'
  readonly requestId: string
  readonly error: { readonly code: string; readonly message: string }
}

export interface AccountInferenceComplete {
  readonly type: 'xiaowei/inference/complete'
  readonly requestId: string
}

/** Parent/child inference messages. No credential or bearer field is permitted. */
export type AccountInferenceMessage =
  | AccountInferenceStart
  | AccountInferenceCancel
  | AccountInferenceChunk
  | AccountInferenceError
  | AccountInferenceComplete

const TYPES = new Set(['xiaowei/inference/start', 'xiaowei/inference/cancel', 'xiaowei/inference/chunk', 'xiaowei/inference/error', 'xiaowei/inference/complete'])
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('IPC message must be an object')
  return value as Record<string, unknown>
}
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`IPC ${field} must be a non-empty string`)
  return value
}
const noUnknown = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`IPC field is not allowed: ${key}`)
}

/** Parse an untrusted process message, rejecting unknown fields and malformed variants. */
export function parseAccountInferenceMessage(value: unknown): AccountInferenceMessage {
  if (typeof value === 'string') {
    try { return parseAccountInferenceMessage(JSON.parse(value) as unknown) } catch (error) {
      throw new Error(`IPC message is not valid JSON: ${error instanceof Error ? error.message : 'invalid payload'}`)
    }
  }
  const input = record(value)
  const type = text(input.type, 'type')
  if (!TYPES.has(type)) throw new Error(`IPC message type is not supported: ${type}`)
  const requestId = text(input.requestId, 'requestId')
  if (type === 'xiaowei/inference/start') {
    noUnknown(input, ['type', 'requestId', 'request'])
    if (input.request === null || typeof input.request !== 'object' || Array.isArray(input.request)) throw new Error('IPC start request must be an object')
    return input as unknown as AccountInferenceStart
  }
  if (type === 'xiaowei/inference/cancel') {
    noUnknown(input, ['type', 'requestId'])
    return { type: 'xiaowei/inference/cancel', requestId }
  }
  if (type === 'xiaowei/inference/chunk') {
    noUnknown(input, ['type', 'requestId', 'chunk'])
    if (input.chunk === null || typeof input.chunk !== 'object') throw new Error('IPC chunk must be an object')
    return input as unknown as AccountInferenceChunk
  }
  if (type === 'xiaowei/inference/error') {
    noUnknown(input, ['type', 'requestId', 'error'])
    const error = record(input.error)
    noUnknown(error, ['code', 'message'])
    return { type: 'xiaowei/inference/error', requestId, error: { code: text(error.code, 'code'), message: text(error.message, 'message') } }
  }
  noUnknown(input, ['type', 'requestId'])
  return { type: 'xiaowei/inference/complete', requestId }
}

/** JSON serialization used by both process ends; rejects non-JSON values. */
export function serializeAccountInferenceMessage(message: AccountInferenceMessage): string {
  const parsed = parseAccountInferenceMessage(JSON.parse(JSON.stringify(message)) as unknown)
  return JSON.stringify(parsed)
}
