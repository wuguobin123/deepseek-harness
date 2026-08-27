/** Locale client assembly: Chinese product default and no Settings row. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

const SLOT = 'settings.general.item'

function declareItems(slots: SlotRegistry): void {
  slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

describe('locale apply', () => {
  it('requires only the slot registry', () => {
    expect(inject).toEqual(['slots'])
  })

  it('provides Chinese copy without registering a language preference row', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    declareItems(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const locale = ctx.get('locale') as LocaleRuntime
    expect(locale.getLocale().active).toBe('zh')
    expect(locale.bind('common')('retry')).toBe('重试')
    expect(slots.entries(SLOT).map(entry => entry.options.id)).not.toContain('language')

    await fiber.dispose()
  })

  it('keeps programmatic locale switches process-local for extension and test compositions', async () => {
    const ctx = new Context()
    new SlotRegistry(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const locale = ctx.get('locale') as LocaleRuntime

    locale.setLocale('en')
    expect(locale.getLocale().active).toBe('en')
    expect(locale.bind('common')('retry')).toBe('Retry')
  })
})
