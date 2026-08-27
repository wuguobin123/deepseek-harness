/** Theme client assembly: light product default and no Settings row. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'

const SLOT = 'settings.general.item'

function declareItems(slots: SlotRegistry): void {
  slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

describe('ui-theme apply', () => {
  it('has no required context service', () => {
    expect(inject).toEqual([])
  })

  it('provides light mode without registering an Appearance preference row', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    declareItems(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const theme = ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme()).toMatchObject({ preference: 'light', active: { id: 'light' } })
    expect(slots.entries(SLOT).map(entry => entry.options.id)).not.toContain('appearance')

    await fiber.dispose()
  })

  it('keeps programmatic theme switches process-local for extension and test compositions', async () => {
    const ctx = new Context()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const theme = ctx.get('theme') as ThemeRuntime

    theme.setTheme('dark')
    expect(theme.getTheme()).toMatchObject({ preference: 'dark', active: { id: 'dark' } })
  })
})
