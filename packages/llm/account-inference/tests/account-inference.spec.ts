import { describe, expect, it } from 'vitest'
import { parseAccountInferenceFrame, parseAccountInferenceFrames, parseAccountInferenceRequest } from '../src/index.ts'

describe('account inference frames', () => {
  it('accepts the complete finish then done sequence', () => {
    expect(parseAccountInferenceFrames([
      { version: 1, type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } },
      { version: 1, type: 'done' },
    ])).toHaveLength(2)
  })

  it('rejects malformed and out-of-order terminal frames', () => {
    expect(() => parseAccountInferenceFrame({ version: 1, type: 'done', extra: true })).toThrow()
    expect(() => parseAccountInferenceFrames([{ version: 1, type: 'error', code: 'x', message: 'failed' }, { version: 1, type: 'done' }])).toThrow()
    expect(() => parseAccountInferenceFrames([{ version: 1, type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }, { version: 1, type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } }])).toThrow()
  })

  it('accepts text tool rounds but rejects local identity, path, and image fields', () => {
    expect(parseAccountInferenceRequest({
      version: 1, model: 'MiniMax-M3', messages: [
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"note.txt"}' }] },
        { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'local result' }] }] },
      ],
    }).messages).toHaveLength(2)
    for (const forbidden of [
      { cwd: '/Users/alice/private' }, { sessionId: 'local-session' }, { owner: 'user-alice' },
    ]) {
      expect(() => parseAccountInferenceRequest({ version: 1, model: 'MiniMax-M3', messages: [], ...forbidden })).toThrow()
    }
    expect(() => parseAccountInferenceRequest({
      version: 1, model: 'MiniMax-M3',
      messages: [{ role: 'user', content: [{ type: 'image', attachment: { id: 'local-file' } }] }],
    })).toThrow()
  })
})
