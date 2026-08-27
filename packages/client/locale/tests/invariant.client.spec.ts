// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-locale'
import { apply as clientApply, COMMON_NS, LocaleRuntime, inject } from '@deepseek-ai/dsh-client-locale/client'
import * as LocaleInvariant from '@deepseek-ai/dsh-client-locale/invariant'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(LocaleInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply tolerates a Host without settings', () => {
    nodeApply(new Context())
  })

  it('client apply provides ctx.locale seeded with the zh/en common namespace', async () => {
    expect(inject).toEqual(['slots'])
    const ctx = new Context()
    new SlotRegistry(ctx)
    await ctx.plugin({ inject, apply: clientApply }).await()
    const locale = ctx.get('locale')
    expect(locale).toBeInstanceOf(LocaleRuntime)
    // Seeded dictionaries occupy the (ns, locale) seats even while empty.
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'zh', {})).toThrow('already has locale')
    expect(() => (locale as LocaleRuntime).register(COMMON_NS, 'en', {})).toThrow('already has locale')
  })
})
