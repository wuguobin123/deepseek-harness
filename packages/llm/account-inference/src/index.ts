/** Versioned, session-free account inference wire protocol. */
import { z } from 'zod'

/** Current account inference request version. */
export const ACCOUNT_INFERENCE_VERSION = 1 as const

/** A text-only message accepted by the account inference endpoint. */
export interface AccountInferenceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | readonly AccountInferenceContentBlock[]
}

/** Non-image content accepted for multi-step tool conversations. */
export type AccountInferenceContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; toolCallId: string; content: readonly ({ type: 'text' | 'reasoning'; text: string })[]; isError?: boolean }

/** JSON-safe projection of a provider stream chunk (brands are restored at the host seam). */
export type AccountInferenceStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: Record<string, unknown> }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } }
  | { type: 'finish'; reason: { kind: string; failure?: Record<string, unknown> }; replayState?: unknown }

/** Strict request body for POST /api/account.inference.stream. */
export interface AccountInferenceRequest {
  version: typeof ACCOUNT_INFERENCE_VERSION
  model: string
  messages: readonly AccountInferenceMessage[]
  system?: string
  temperature?: number
  maxTokens?: number
  stop?: readonly string[]
  tools?: readonly { name: string; description: string; parameters: Record<string, unknown> }[]
}

/** NDJSON records emitted by the account inference endpoint. */
export type AccountInferenceFrame =
  | { version: typeof ACCOUNT_INFERENCE_VERSION; type: 'chunk'; chunk: AccountInferenceStreamChunk }
  | { version: typeof ACCOUNT_INFERENCE_VERSION; type: 'done' }
  | { version: typeof ACCOUNT_INFERENCE_VERSION; type: 'error'; code: string; message: string }

const contentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning'), text: z.string() }).strict(),
  z.object({ type: z.literal('image'), attachment: z.unknown() }).strict(),
  z.object({ type: z.literal('tool-call'), id: z.string(), name: z.string(), arguments: z.string() }).strict(),
  z.object({ type: z.literal('tool-result'), toolCallId: z.string(), content: z.array(z.unknown()), isError: z.boolean().optional() }).strict(),
])
const streamChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('block-start'), index: z.number().int().nonnegative(), blockType: z.string() }).strict(),
  z.object({ type: z.literal('text-delta'), index: z.number().int().nonnegative(), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning-delta'), index: z.number().int().nonnegative(), text: z.string() }).strict(),
  z.object({ type: z.literal('tool-call-delta'), index: z.number().int().nonnegative(), id: z.string(), name: z.string().optional(), argumentsDelta: z.string() }).strict(),
  z.object({ type: z.literal('block-end'), index: z.number().int().nonnegative(), block: contentBlockSchema }).strict(),
  z.object({ type: z.literal('usage'), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), cacheReadTokens: z.number().int().nonnegative().optional(), cacheWriteTokens: z.number().int().nonnegative().optional(), reasoningTokens: z.number().int().nonnegative().optional() }).strict() }).strict(),
  z.object({ type: z.literal('finish'), reason: z.union([
    z.object({ kind: z.enum(['stop', 'tool-calls', 'max-tokens']) }).strict(),
    z.object({ kind: z.enum(['aborted', 'error']), failure: z.object({ message: z.string(), code: z.string() }).passthrough() }).strict(),
  ]), replayState: z.unknown().optional() }).strict(),
])

/** Runtime parser for one versioned NDJSON frame. */
export const accountInferenceFrameSchema = z.discriminatedUnion('type', [
  z.object({ version: z.literal(ACCOUNT_INFERENCE_VERSION), type: z.literal('chunk'), chunk: streamChunkSchema }).strict(),
  z.object({ version: z.literal(ACCOUNT_INFERENCE_VERSION), type: z.literal('done') }).strict(),
  z.object({ version: z.literal(ACCOUNT_INFERENCE_VERSION), type: z.literal('error'), code: z.string().min(1), message: z.string().min(1) }).strict(),
])

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([
    z.string().min(1).max(1_000_000),
    z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string().max(1_000_000) }).strict(),
      z.object({ type: z.literal('reasoning'), text: z.string().max(1_000_000) }).strict(),
      z.object({ type: z.literal('tool-call'), id: z.string().min(1).max(256), name: z.string().min(1).max(256), arguments: z.string().max(1_000_000) }).strict(),
      z.object({ type: z.literal('tool-result'), toolCallId: z.string().min(1).max(256), content: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string().max(1_000_000) }).strict(),
        z.object({ type: z.literal('reasoning'), text: z.string().max(1_000_000) }).strict(),
      ])).max(1_000), isError: z.boolean().optional() }).strict(),
    ])).max(1_000),
  ]),
}).strict()

/** Runtime parser; unknown and session/workspace/file fields are rejected. */
export const accountInferenceRequestSchema = z.object({
  version: z.literal(ACCOUNT_INFERENCE_VERSION),
  model: z.string().min(1).max(256),
  messages: z.array(messageSchema).max(1_000),
  system: z.string().max(1_000_000).optional(),
  temperature: z.number().finite().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  stop: z.array(z.string().min(1).max(256)).max(16).optional(),
  tools: z.array(z.object({
    name: z.string().min(1).max(256),
    description: z.string().max(10_000),
    parameters: z.record(z.string(), z.unknown()),
  }).strict()).max(128).optional(),
}).strict()

/** Parse one strict account inference request. */
export function parseAccountInferenceRequest(value: unknown): AccountInferenceRequest {
  return accountInferenceRequestSchema.parse(value) as AccountInferenceRequest
}

/** Parse and validate a complete stream, including terminal-frame ordering. */
export function parseAccountInferenceFrames(values: Iterable<unknown>): AccountInferenceFrame[] {
  const frames: AccountInferenceFrame[] = []
  let terminal: 'error' | 'finish' | 'done' | undefined
  for (const value of values) {
    const frame = accountInferenceFrameSchema.parse(value) as AccountInferenceFrame
    if (terminal === 'error' || terminal === 'done') throw new Error('account inference frame follows a terminal frame')
    if (terminal === 'finish' && frame.type !== 'done') throw new Error('account inference finish must be followed by done')
    if (frame.type === 'error') terminal = 'error'
    else if (frame.type === 'done') {
      if (terminal !== 'finish') throw new Error('account inference done requires a finish chunk')
      terminal = 'done'
    } else if (frame.type === 'chunk' && frame.chunk.type === 'finish') terminal = 'finish'
    frames.push(frame)
  }
  if (terminal === 'finish') throw new Error('account inference stream is missing done')
  return frames
}

/** Parse one JSON NDJSON line as a frame. */
export function parseAccountInferenceFrame(value: unknown): AccountInferenceFrame {
  return accountInferenceFrameSchema.parse(value) as AccountInferenceFrame
}
