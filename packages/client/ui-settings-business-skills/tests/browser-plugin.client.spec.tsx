// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { BusinessSkillsSettingsTab } from '../src/client/BusinessSkillsSettingsTab.tsx'

afterEach(cleanup)
describe('business skills browser plugin', () => {
  it('registers a localized tab and forwards the API face', async () => {
    const api = {
      businessSkills: {
        list: vi.fn(async () => ({ result: { ok: true as const, value: { items: [] } } })),
        validate: vi.fn(),
        publish: vi.fn(),
        disable: vi.fn(),
        rollback: vi.fn(),
      },
    }
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('connection', { isLoopback: false, api } as never)
    const slots = ctx.get('slots') as SlotRegistry
    const stop = slots.register({
      name: 'root',
      children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(BusinessSkillsSettingsTab)
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('业务 Skill')
    const injected = (entry.inject as never as () => { list(): Promise<unknown[]> })()
    await expect(injected.list()).resolves.toEqual([])
    expect(api.businessSkills.list).toHaveBeenCalledWith({})
    stop()
    await ctx.fiber.dispose()
  })
})
