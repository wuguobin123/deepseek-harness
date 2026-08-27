import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as plugin from '@deepseek-ai/dsh-tool-knowledge'

describe('tool-knowledge loader exports', () => {
  it('keeps the namespace and has no default export', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as typeof plugin
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('tool-knowledge')
    expect(unwrapped.inject).toEqual(['tools', 'knowledge', 'systemPrompt'])
  })
})
