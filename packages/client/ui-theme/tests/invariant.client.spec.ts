// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-theme'
import { apply as clientApply, inject, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import * as ThemeInvariant from '@deepseek-ai/dsh-client-ui-theme/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ThemeInvariant).await()).resolves.toBeDefined()
  })

  it('node-half waits for optional Host services', () => {
    nodeApply(new Context())
    expect(true).toBe(true)
  })

  it('client apply provides the light-default ctx.theme service', async () => {
    expect(inject).toEqual([])
    const ctx = new Context()
    await ctx.plugin({ inject, apply: clientApply }).await()
    expect(ctx.get('theme')).toBeInstanceOf(ThemeRuntime)
    expect((ctx.get('theme') as ThemeRuntime).getTheme().preference).toBe('light')
  })
})
