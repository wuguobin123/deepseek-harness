import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { LOCALE_SETTINGS_NAMESPACE, apply } from '@deepseek-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  it('does not register a language setting', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin({ apply }).await()
    expect(ctx.settings.describe().map(row => row.ns))
      .not.toContain(settingsNamespace(LOCALE_SETTINGS_NAMESPACE))
  })
})
