import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import LocalAccountPluginFactory, { mountAccountPlugins, PluginFactoryError } from '@deepseek-ai/dsh-account-plugin-factory'

async function scoped(ctx: Context, key: ScopeKey): Promise<ReturnType<typeof createScope>> {
  let scope!: ReturnType<typeof createScope>
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] },
  ))
  return scope
}

function registerFixtureTool(name: string): (ctx: Context) => void {
  return (ctx) => {
    ctx.tools.register({
      name,
      description: `${name} fixture.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) ?? '' }],
      },
      execute: () => Promise.resolve(name),
    })
  }
}

describe('account plugin factory', () => {
  it('isolates install rows by account and keeps system defaults immutable', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [
        { pluginId: 'core', title: 'Core', description: 'Built in', version: '1', systemDefault: true },
        { pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1', systemDefault: false, activationId: 'optional' },
      ],
      activators: { optional: () => {} },
    }).await()
    expect(await ctx.accountPluginFactory.list({ userId: 'user-a' })).toEqual([
      { pluginId: 'core', title: 'Core', description: 'Built in', version: '1', systemDefault: true, installed: true },
      { pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1', systemDefault: false, installed: false },
    ])
    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'optional' })
    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'optional' })
    expect((await ctx.accountPluginFactory.list({ userId: 'user-a' }))[1]?.installed).toBe(true)
    expect((await ctx.accountPluginFactory.list({ userId: 'user-b' }))[1]?.installed).toBe(false)
    await expect(ctx.accountPluginFactory.uninstall({ userId: 'user-a', pluginId: 'core' }))
      .rejects.toMatchObject({ code: 'PLUGIN_DEFAULT' } satisfies Partial<PluginFactoryError>)
    await ctx.accountPluginFactory.uninstall({ userId: 'user-a', pluginId: 'optional' })
    await ctx.accountPluginFactory.uninstall({ userId: 'user-a', pluginId: 'optional' })
    expect((await ctx.accountPluginFactory.list({ userId: 'user-a' }))[1]?.installed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('activates real default plugins for every account while isolating optional plugins', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [
        { pluginId: 'default', title: 'Default', description: 'Built in', version: '1', systemDefault: true, activationId: 'default' },
        { pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1', systemDefault: false, activationId: 'optional' },
      ],
      activators: { default: registerFixtureTool('default_tool'), optional: registerFixtureTool('optional_tool') },
    })
    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'optional' })

    const accountAKey = {} as ScopeKey
    const accountA = await scoped(ctx, accountAKey)
    await mountAccountPlugins(accountA.ctx, { userId: 'user-a' })
    const accountBKey = {} as ScopeKey
    const accountB = await scoped(ctx, accountBKey)
    await mountAccountPlugins(accountB.ctx, { userId: 'user-b' })

    expect(ctx.tools.schemas(accountAKey).map(tool => tool.name)).toEqual(expect.arrayContaining(['default_tool', 'optional_tool']))
    expect(ctx.tools.schemas(accountBKey).map(tool => tool.name)).toEqual(['default_tool'])
    await ctx.fiber.dispose()
  })

  it('rejects duplicate, invalid, and unmountable catalog entries at load', async () => {
    const duplicate = new Context()
    await expect(duplicate.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [
        { pluginId: 'same', title: 'One', description: '', version: '1', systemDefault: true },
        { pluginId: 'same', title: 'Two', description: '', version: '1', systemDefault: true },
      ],
    }).await()).rejects.toThrow('duplicate pluginId')
    const invalid = new Context()
    await expect(invalid.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [{ pluginId: '../escape', title: 'Bad', description: '', version: '1', systemDefault: false, activationId: 'bad' }],
      activators: { bad: () => {} },
    }).await()).rejects.toThrow('invalid pluginId')
    const missing = new Context()
    await expect(missing.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [{ pluginId: 'missing', title: 'Missing', description: '', version: '1', systemDefault: false }],
    }).await()).rejects.toThrow('has no activationId')
  })

  it('mounts an installed composition only into later scopes for that account', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [{
        pluginId: 'todo', title: 'Todo', description: 'Task list', version: '1',
        systemDefault: false, activationId: 'todo',
      }],
      activators: {
        todo: (inner) => {
          if (scopeOf(inner) === undefined) throw new Error('fixture activator lost its scope')
          inner.tools.register({
            name: 'account_tool',
            description: 'Account-scoped plugin fixture.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value) ?? '',
              }],
            },
            execute: () => Promise.resolve('account_tool'),
          })
        },
      },
    })
    const oldKey = {} as ScopeKey
    const old = await scoped(ctx, oldKey)
    await mountAccountPlugins(old.ctx, { userId: 'user-a' })
    expect(ctx.tools.schemas(oldKey).map(tool => tool.name)).not.toContain('account_tool')

    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'todo' })
    const accountAKey = {} as ScopeKey
    const accountA = await scoped(ctx, accountAKey)
    await mountAccountPlugins(accountA.ctx, { userId: 'user-a' })
    const accountBKey = {} as ScopeKey
    const accountB = await scoped(ctx, accountBKey)
    await mountAccountPlugins(accountB.ctx, { userId: 'user-b' })
    expect(ctx.tools.schemas(accountAKey).map(tool => tool.name)).toContain('account_tool')
    expect(ctx.tools.schemas(accountBKey).map(tool => tool.name)).not.toContain('account_tool')
    expect(ctx.tools.schemas(oldKey).map(tool => tool.name)).not.toContain('account_tool')
    await ctx.fiber.dispose()
  })

  it('restores a durable selection without rereading mutable account state', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [
        {
          pluginId: 'default', title: 'Default', description: 'Built in', version: '1',
          systemDefault: true, activationId: 'default',
        },
        {
          pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1',
          systemDefault: false, activationId: 'optional',
        },
      ],
      activators: { default: registerFixtureTool('default_tool'), optional: registerFixtureTool('optional_tool') },
    })
    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'optional' })
    const selection = await ctx.accountPluginFactory.selected({ userId: 'user-a' })
    const seed = ctx.accountPluginFactory.selectionSeed({ pluginIds: selection })
    await ctx.accountPluginFactory.uninstall({ userId: 'user-a', pluginId: 'optional' })

    const restoredKey = {} as ScopeKey
    const restored = await scoped(ctx, restoredKey)
    await mountAccountPlugins(restored.ctx, { userId: 'user-a', events: [seed] })
    expect(ctx.tools.schemas(restoredKey).map(tool => tool.name).sort()).toEqual(['default_tool', 'optional_tool'])

    const legacyKey = {} as ScopeKey
    const legacy = await scoped(ctx, legacyKey)
    await mountAccountPlugins(legacy.ctx, { userId: 'user-a', events: [] })
    expect(ctx.tools.schemas(legacyKey).map(tool => tool.name)).toEqual(['default_tool'])
    expect(() => ctx.accountPluginFactory.activationsFromEvents([{
      ...seed, data: { pluginIds: ['removed-from-catalog'] },
    }])).toThrow(expect.objectContaining({ code: 'PLUGIN_NOT_FOUND' } satisfies Partial<PluginFactoryError>))
    expect(() => ctx.accountPluginFactory.activationsFromEvents([seed, { ...seed, seq: 1 }]))
      .toThrow(expect.objectContaining({ code: 'PLUGIN_NOT_FOUND' } satisfies Partial<PluginFactoryError>))
    await ctx.fiber.dispose()
  })

  it('activates the bundled precise editor only for the installing account scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await ctx.plugin(LocalAccountPluginFactory, { path: ':memory:' })
    await ctx.accountPluginFactory.install({ userId: 'user-a', pluginId: 'precise-editor' })
    const accountAKey = {} as ScopeKey
    const accountA = await scoped(ctx, accountAKey)
    await mountAccountPlugins(accountA.ctx, { userId: 'user-a' })
    const accountBKey = {} as ScopeKey
    const accountB = await scoped(ctx, accountBKey)
    await mountAccountPlugins(accountB.ctx, { userId: 'user-b' })
    expect(ctx.tools.schemas(accountAKey).map(tool => tool.name)).toContain('str_replace_editor')
    expect(ctx.tools.schemas(accountBKey).map(tool => tool.name)).not.toContain('str_replace_editor')
    await ctx.fiber.dispose()
  })
})
