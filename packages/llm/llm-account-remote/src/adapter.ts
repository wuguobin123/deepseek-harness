import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { parseAccountInferenceMessage, serializeAccountInferenceMessage, type AccountInferenceMessage, type AccountInferenceStart, type AccountInferenceRequest } from './ipc.ts'

const PROVIDER = 'xiaowei-minimax'
const MODEL = 'MiniMax-M3'

export function accountInferenceRequestFromOptions(options: GenerateOptions): AccountInferenceRequest {
  if (options.provider !== PROVIDER) throw new LlmError(`unknown account provider: ${options.provider}`, 'UNKNOWN_PROVIDER')
  if (options.model !== MODEL) throw new LlmError(`unsupported account model: ${options.model}`, 'UNKNOWN_MODEL')
  const messages = options.messages.map(message => ({
    role: message.role,
    content: message.content.map((block) => {
      if (block.type === 'text' || block.type === 'reasoning') return { ...block }
      if (block.type === 'tool-call') return { ...block }
      if (block.type === 'tool-result') return { ...block, content: block.content.map((item) => {
        if (item.type !== 'text') throw new LlmError('non-text tool result cannot cross account IPC', 'CROSS_BOUNDARY_INPUT')
        return { ...item }
      }) }
      throw new LlmError('image or file content cannot cross account IPC', 'CROSS_BOUNDARY_INPUT')
    }),
  }))
  return {
    version: 1, model: MODEL,
    ...(options.system === undefined ? {} : { system: options.system }), messages,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: [...options.stop] }),
  }
}

/** Device adapter that delegates account inference to the trusted parent process. */
export class AccountRemoteAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo { return { id: provider, name: '小薇 MiniMax' } }
  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider: PROVIDER, id: MODEL, name: MODEL, inputModalities: ['text'] }])
  }
  override resolveModel(provider: string, model: string): Promise<LlmModelInfo> {
    if (provider !== PROVIDER || model !== MODEL) throw new LlmError('unsupported account model route', 'UNKNOWN_MODEL')
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const start: AccountInferenceStart = { type: 'xiaowei/inference/start', requestId: crypto.randomUUID(), request: accountInferenceRequestFromOptions(options) }
    if (typeof process.send !== 'function') throw new LlmError('account IPC is unavailable', 'IPC_UNAVAILABLE')
    const send = process.send.bind(process)
    const requestId = start.requestId
    const queue: AccountInferenceMessage[] = []
    let wake: (() => void) | undefined
    let done = false
    const onMessage = (value: unknown): void => {
      try {
        const message = parseAccountInferenceMessage(value)
        if (message.requestId !== requestId) return
        queue.push(message); wake?.(); wake = undefined
      } catch { /* unrelated or malformed parent messages cannot affect this stream */ }
    }
    process.on('message', onMessage)
    const cancel = (): void => { if (!done) send(serializeAccountInferenceMessage({ type: 'xiaowei/inference/cancel', requestId })) }
    options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      send(serializeAccountInferenceMessage(start))
      while (true) {
        if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve })
        const message = queue.shift()
        if (!message) continue
        if (message.type === 'xiaowei/inference/chunk') { yield message.chunk; continue }
        if (message.type === 'xiaowei/inference/complete') return
        if (message.type === 'xiaowei/inference/error') throw new LlmError(message.error.message, message.error.code)
      }
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('account inference aborted', 'ABORTED')
      if (error instanceof LlmError) throw error
      throw new LlmError('account inference IPC failed', 'IPC_ERROR', { cause: error })
    } finally {
      done = true; process.off('message', onMessage); options.signal?.removeEventListener('abort', cancel)
    }
  }
}

export { PROVIDER as ACCOUNT_PROVIDER, MODEL as ACCOUNT_MODEL }
