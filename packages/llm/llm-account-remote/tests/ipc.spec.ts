import { describe, expect, it, vi } from 'vitest'
import { parseAccountInferenceMessage, serializeAccountInferenceMessage } from '../src/ipc.ts'
import { AccountRemoteAdapter, accountInferenceRequestFromOptions } from '../src/adapter.ts'

describe('account inference IPC', () => {
  it('round-trips a request without credential fields', () => {
    const message = {
      type: 'xiaowei/inference/start' as const, requestId: 'r1', request: { version: 1 as const, model: 'MiniMax-M3', messages: [] },
    }
    expect(parseAccountInferenceMessage(serializeAccountInferenceMessage(message))).toEqual(message)
  })

  it('rejects unknown fields such as bearer credentials', () => {
    expect(() => parseAccountInferenceMessage({
      type: 'xiaowei/inference/start', requestId: 'r1', request: {}, bearer: 'secret',
    })).toThrow('not allowed')
  })

  it('accepts only the five protocol message kinds', () => {
    expect(parseAccountInferenceMessage(JSON.stringify({ type: 'xiaowei/inference/complete', requestId: 'r1' }))).toEqual({ type: 'xiaowei/inference/complete', requestId: 'r1' })
    expect(() => parseAccountInferenceMessage({ type: 'wat', requestId: 'r1' })).toThrow('not supported')
  })

  it('drops local identity and source fields while retaining a tool round', () => {
    const request = accountInferenceRequestFromOptions({
      provider: 'xiaowei-minimax', model: 'MiniMax-M3', sessionId: 'local' as never,
      messages: [
        { id: 'm1' as never, role: 'assistant', source: { kind: 'model', provider: 'xiaowei-minimax', model: 'MiniMax-M3' }, content: [{ type: 'tool-call', id: 'c1' as never, name: 'read', arguments: '{"path":"x"}' }] },
        { id: 'm2' as never, role: 'user', source: { kind: 'tool', callId: 'c1' as never }, content: [{ type: 'tool-result', toolCallId: 'c1' as never, content: [{ type: 'text', text: 'ok' }] }] },
      ],
    })
    expect(request).toMatchObject({ version: 1, model: 'MiniMax-M3' })
    expect(request.messages[0]).not.toHaveProperty('id')
    expect(request.messages[0]).not.toHaveProperty('source')
    expect(request.messages[0]?.content).toEqual([{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"x"}' }])
    expect(JSON.stringify(request)).not.toContain('sessionId')
  })

  it('returns a cloud tool call to the device Agent Loop while keeping IPC credential-free', async () => {
    const originalSend = process.send
    const sent: string[] = []
    Object.defineProperty(process, 'send', {
      configurable: true,
      value: vi.fn(function (this: NodeJS.Process, payload: string) {
        if (this !== process) throw new Error('process.send receiver was lost')
        sent.push(payload)
        const start = parseAccountInferenceMessage(payload)
        if (start.type !== 'xiaowei/inference/start') return true
        queueMicrotask(() => {
          process.emit('message', serializeAccountInferenceMessage({
            type: 'xiaowei/inference/chunk', requestId: start.requestId,
            chunk: { type: 'tool-call-delta', index: 0, id: 'call-1' as never, name: 'read', argumentsDelta: '{"path":"note.txt"}' },
          }), undefined)
          process.emit('message', serializeAccountInferenceMessage({
            type: 'xiaowei/inference/chunk', requestId: start.requestId,
            chunk: { type: 'finish', reason: { kind: 'tool-calls' } },
          }), undefined)
          process.emit('message', serializeAccountInferenceMessage({
            type: 'xiaowei/inference/complete', requestId: start.requestId,
          }), undefined)
        })
        return true
      }),
    })
    try {
      const chunks = []
      for await (const chunk of new AccountRemoteAdapter().stream({
        provider: 'xiaowei-minimax', model: 'MiniMax-M3', messages: [],
        tools: [{ name: 'read', description: 'Read a local file', parameters: { type: 'object' } }],
      })) chunks.push(chunk)

      expect(chunks).toEqual([
        { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '{"path":"note.txt"}' },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ])
      expect(JSON.stringify(sent)).not.toMatch(/bearer|api[_-]?key|sessionId|workspace/i)
    } finally {
      Object.defineProperty(process, 'send', { configurable: true, value: originalSend })
    }
  })
})
