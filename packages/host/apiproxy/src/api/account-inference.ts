import type { StreamChunk, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { AccountInferenceRequest, AccountInferenceFrame, AccountInferenceContentBlock } from '@deepseek-ai/dsh-llm-account-inference'
import type { RpcRequest } from './rpc.ts'

/** Account inference API exposed as a direct NDJSON stream carrier. */
export interface AccountInferenceApi {
  /** Stream one session-free, account-owned model request. */
  stream(request: RpcRequest<AccountInferenceRequest>, signal: AbortSignal): AsyncIterable<AccountInferenceFrame>
}

/** Convert the wire conversation to the internal message representation. */
export function accountInferenceOptions(request: AccountInferenceRequest, signal: AbortSignal): GenerateOptions {
  let system = request.system
  const messages: Message[] = []
  for (const input of request.messages) {
    if (input.role === 'system') {
      const text = typeof input.content === 'string' ? input.content : input.content.filter((block: AccountInferenceContentBlock): block is Extract<AccountInferenceContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
      system = system === undefined ? text : `${system}\n${text}`
      continue
    }
    const content = typeof input.content === 'string' ? [{ type: 'text' as const, text: input.content }] : input.content.map((block) => {
      if (block.type === 'tool-call') return { ...block, id: CallId(block.id) }
      if (block.type === 'tool-result') return { ...block, toolCallId: CallId(block.toolCallId), content: block.content.map(result => ({ ...result })) }
      return { ...block }
    })
    const toolResult = content.find((block): block is Extract<(typeof content)[number], { type: 'tool-result' }> => block.type === 'tool-result')
    messages.push(createMessage({
      role: input.role,
      content,
      source: input.role === 'assistant'
        ? { kind: 'model', provider: 'xiaowei-minimax', model: request.model }
        : toolResult === undefined ? { kind: 'user' } : { kind: 'tool', callId: toolResult.toolCallId },
    }))
  }
  return {
    provider: 'xiaowei-minimax', model: request.model, messages,
    ...(system === undefined ? {} : { system }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.stop === undefined ? {} : { stop: [...request.stop] }),
    ...(request.tools === undefined ? {} : { tools: [...request.tools] }),
    signal,
  }
}

export type AccountInferenceChunk = StreamChunk
