/**
 * Registration: the General row and header label come from one apply, and each
 * defers until the slot it fills has been declared. A pushed settings change
 * refreshes the default selector.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelInjected } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetRow } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetRowInjected } from '../src/client/AgentPresetRow.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); each bench stages zh explicitly on the locale instead.

const ROSTER_ONE = {
  rpcId: 'r',
  result: {
    ok: true as const,
    value: {
      presets: [{ id: 'standard', trust: 'system', isDefault: true }],
      authorable: true,
      hasDocument: true,
    },
  },
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  const calls: string[] = []
  ctx.provide('connection', {
    api: {
      agentPresets: {
        list: () => { calls.push('list'); return Promise.resolve(ROSTER_ONE) },
      },
      settings: {
        // The row reads this to learn whether this browser may write at all.
        describe: () => Promise.resolve({
          rpcId: 'r',
          result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
        }),
        update: (payload: { patch: unknown }) => { calls.push(`settings:${JSON.stringify(payload.patch)}`); return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } }) },
      },
    },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, calls }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      conversation: { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

/** The conversation's own declaration, which the label waits for. */
function declareConversation(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'conversation',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

/** A sessions double that records pushed preset commits. */
function sessionsDouble(state: {
  current?: string
  byId: Record<string, { id: string; blank: boolean; agentPreset?: string }>
}) {
  return {
    noteAgentPreset: (sessionId: string, agentPreset: string) => {
      const summary = state.byId[sessionId]
      if (summary === undefined || summary.agentPreset === agentPreset) return
      summary.agentPreset = agentPreset
    },
  }
}

describe('ui-agent-preset apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers the General row without an Agent presets section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const row = slots.entries('settings.general.item')[0]!
    expect(row.component).toBe(AgentPresetRow)
    expect(row.options).toMatchObject({ id: 'agent-preset', order: -25 })
    expect(slots.entries('settings.section')).toHaveLength(0)
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.general.item')).toHaveLength(1) })
  })

  it('refreshes the General row when its namespace changes, and ignores others', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const row = (slots.entries('settings.general.item')[0]!.inject as unknown as () => AgentPresetRowInjected)()
    await row.load()
    const before = calls.length

    ctx.remote.$dispatch('settings/document-updated', ['agent-presets', 1])
    await vi.waitFor(() => { expect(calls.length).toBe(before + 1) })
    const afterRelevant = calls.length

    ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()

    // The row re-reads on its own namespace; an unrelated write does not
    // trigger a blanket refresh.
    expect(calls.length).toBe(afterRelevant)
  })

  it('re-reads the General row when the connection comes back', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const row = (slots.entries('settings.general.item')[0]!.inject as unknown as () => AgentPresetRowInjected)()
    await row.load()
    const before = calls.length

    ctx.emit('connection/reset')

    // A reconnect can land on a host whose roster changed under the browser.
    await vi.waitFor(() => { expect(calls.length).toBe(before + 1) })
  })

  it('registers the header label and drops it on disposal', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const conversation = declareConversation(slots)
    ctx.provide('conversation', {} as never)
    ctx.provide('sessions', sessionsDouble({ byId: {} }) as never)
    const fiber = ctx.plugin({ inject: [...inject, 'conversation', 'sessions'], apply })
    await fiber.await()

    const label = slots.entries('conversation.session.header.actions')[0]!
    expect(label.component).toBe(AgentPresetLabel)
    expect(label.options).toMatchObject({ id: 'agent-preset', order: -10 })
    await fiber.dispose()
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('settings.section')).toHaveLength(0)
    conversation()
  })

  it('folds a remote preset commit into the shared session row', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    declareConversation(slots)
    ctx.provide('conversation', {} as never)
    const state = {
      current: 's1',
      byId: { s1: { id: 's1', blank: true, agentPreset: 'standard' } },
    }
    ctx.provide('sessions', sessionsDouble(state) as never)
    await ctx.plugin({ inject: [...inject, 'conversation', 'sessions'], apply }).await()

    ctx.remote.$dispatch('agent-preset/selected', ['s1', 'minimal'])

    expect(state.byId.s1.agentPreset).toBe('minimal')
  })

  it('gives the header label the same roster the General row reads', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    declareConversation(slots)
    ctx.provide('conversation', {} as never)
    ctx.provide('sessions', sessionsDouble({ byId: {} }) as never)
    await ctx.plugin({ inject: [...inject, 'conversation', 'sessions'], apply }).await()
    const label = (slots.entries('conversation.session.header.actions')[0]!
      .inject as unknown as () => AgentPresetLabelInjected)()
    const row = (slots.entries('settings.general.item')[0]!
      .inject as unknown as () => AgentPresetRowInjected)()

    await label.load()

    // One roster behind both: the label resolves a name the settings row's own
    // load already fetched, rather than issuing a second read per session.
    expect(label.hooks.agentPresets).toBe(row.hooks.agentPreset)
    expect(label.hooks.agentPresets.getSnapshot().options).toEqual([{ id: 'standard', trust: 'system' }])
  })

})
