import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { apply as applyPreciseEditor } from '@deepseek-ai/dsh-tool-str-replace-editor'
import { PluginFactoryError } from './errors.ts'
import { openPluginDatabase, PluginStore } from './store.ts'
import type { AccountPluginView, PluginCatalogEntry } from './types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
export * from './errors.ts'
export * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Optional plugin ids used to compose this Session, recorded at creation.
     * Required and log-only: restoration and forks rebuild from this snapshot
     * instead of mutable account installation state.
     */
    'account-plugins/selected': { pluginIds: string[] }
  }
}

/** One server-registered activation implementation. */
export type PluginActivator = (ctx: Context) => Promise<void> | void

/** Plugin factory configuration. The catalog is deployment-owned and read-only at runtime. */
export interface Config {
  /** SQLite database path used for account installation state. */
  path: string
  /** Deployment-owned plugin catalog exposed to accounts. */
  catalog?: PluginCatalogEntry[]
  /** Programmatic extension point for deployment-owned catalog activators. */
  activators?: Readonly<Record<string, PluginActivator>>
}

const BUILTIN_ACTIVATORS: Readonly<Record<string, PluginActivator>> = {
  'core-tools': () => {},
  'precise-editor': (ctx) => {
    const fs = ctx.root.get('fs')
    if (fs === undefined) throw new Error('precise-editor requires the host filesystem service')
    applyPreciseEditor(ctx.extend({ fs }), {})
  },
}

/** Product catalog bundled with the factory. Deployments may replace it through config. */
export const BUILTIN_CATALOG = [
  {
    pluginId: 'core-tools',
    title: '基础工具',
    description: '系统预装的对话、文件、任务和联网能力。',
    version: '1',
    systemDefault: true,
    activationId: 'core-tools',
  },
  {
    pluginId: 'precise-editor',
    title: '精确编辑器',
    description: '为 Agent 增加按原文精确替换文件内容的编辑工具。',
    version: '1',
    systemDefault: false,
    activationId: 'precise-editor',
  },
] as const satisfies readonly PluginCatalogEntry[]
export const Config: z<Config> = z.object({ path: z.string().required(), catalog: z.array(z.object({
  pluginId: z.string().min(1).required(), title: z.string().required(), description: z.string().required(), version: z.string().required(),
  systemDefault: z.boolean().default(false), activationId: z.string(),
})).default([...BUILTIN_CATALOG]), activators: z.any() })

declare module '@deepseek-ai/cordis' { interface Context { accountPluginFactory: AccountPluginFactoryService } }

/**
 * Apply this account's server-owned activators to the supplied agent scope.
 * @param ctx - unpublished agent context receiving scoped registrations.
 * @param input - authoritative account identity resolved by the host.
 */
export async function mountAccountPlugins(ctx: Context, input: {
  userId: string
  /** Existing session log used during cold restore; avoids reading mutable account state. */
  events?: readonly SessionEvent[]
  /** Explicit selection used while creating a new session. */
  pluginIds?: readonly string[]
}): Promise<void> {
  const factory = ctx.root.get('accountPluginFactory')
  if (factory === undefined) return
  const activators = input.events === undefined
    ? input.pluginIds === undefined
      ? await factory.activations(input)
      : factory.activationsFor({ pluginIds: input.pluginIds })
    : factory.activationsFromEvents(input.events)
  for (const activator of activators) await activator(ctx)
}

/** Account-scoped plugin install state and server-side catalog. */
export abstract class AccountPluginFactoryService extends Service {
  constructor(ctx: Context) { super(ctx, 'accountPluginFactory') }
  /**
   * Read the public catalog for one account.
   * @param input - authoritative account identity.
   * @returns public catalog with installation state.
   */
  abstract list(input: { userId: string }): Promise<AccountPluginView[]>
  /**
   * Install one optional catalog entry.
   * @param input - authoritative account and server catalog id.
   * @returns installed public row.
   */
  abstract install(input: { userId: string; pluginId: string }): Promise<AccountPluginView>
  /**
   * Uninstall one optional catalog entry.
   * @param input - authoritative account and server catalog id.
   * @returns uninstalled public row.
   */
  abstract uninstall(input: { userId: string; pluginId: string }): Promise<AccountPluginView>
  /**
   * Resolve entries enabled for a later agent.
   * @param input - authoritative account identity.
   * @returns enabled server catalog entries.
   */
  abstract composition(input: { userId: string }): Promise<PluginCatalogEntry[]>
  /**
   * Resolve activators for the account's next agent scope.
   * @param input - authoritative account identity.
   * @returns server-owned activation functions.
   */
  abstract activations(input: { userId: string }): Promise<PluginActivator[]>
  /**
   * Resolve activators for an explicit optional selection plus system defaults.
   * @param input - optional plugin ids recorded for one session.
   * @returns server-owned activation functions in catalog order.
   */
  abstract activationsFor(input: { pluginIds: readonly string[] }): PluginActivator[]
  /**
   * Resolve activators from a durable session selection snapshot.
   * @param events - authoritative session log events.
   * @returns server-owned activation functions from the recorded selection.
   */
  abstract activationsFromEvents(events: readonly SessionEvent[]): PluginActivator[]
  /**
   * Read the account's optional selection in catalog order.
   * @param input - authoritative account identity.
   * @returns optional plugin ids selected for later sessions.
   */
  abstract selected(input: { userId: string }): Promise<string[]>
  /**
   * Construct the seq-zero selection snapshot for a newly created session.
   * @param input - optional plugin ids selected for the new session.
   * @returns durable session event recording the selection.
   */
  abstract selectionSeed(input: { pluginIds: readonly string[] }): SessionEvent<'account-plugins/selected'>
}

/** Default SQLite-backed account plugin factory. */
export class LocalAccountPluginFactory extends AccountPluginFactoryService {
  static Config = Config
  private ready: Promise<PluginStore> | undefined
  private readonly catalog: readonly PluginCatalogEntry[]
  private readonly activators: Readonly<Record<string, PluginActivator>>
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.catalog = config.catalog ?? BUILTIN_CATALOG
    this.activators = { ...BUILTIN_ACTIVATORS, ...config.activators }
    const ids = new Set<string>()
    for (const entry of this.catalog) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.pluginId)) throw new TypeError(`invalid pluginId: ${entry.pluginId}`)
      if (ids.has(entry.pluginId)) throw new TypeError(`duplicate pluginId: ${entry.pluginId}`)
      ids.add(entry.pluginId)
      if (!entry.systemDefault && entry.activationId === undefined) {
        throw new TypeError(`installable plugin has no activationId: ${entry.pluginId}`)
      }
      if (entry.activationId !== undefined && this.activators[entry.activationId] === undefined) {
        throw new TypeError(`unknown plugin activationId: ${entry.activationId}`)
      }
    }
  }
  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore(); yield () =>{  store.close() }
  }
  private openStore(): Promise<PluginStore> {
    this.ready ??= openPluginDatabase(this.config.path).then(db => new PluginStore(db))
    return this.ready
  }
  private entry(pluginId: string): PluginCatalogEntry {
    const entry = this.catalog.find(item => item.pluginId === pluginId)
    if (entry === undefined) throw new PluginFactoryError('PLUGIN_NOT_FOUND', `unknown plugin: ${pluginId}`)
    return entry
  }
  async list(input: { userId: string }): Promise<AccountPluginView[]> {
    const installed = (await this.openStore()).installed(input.userId)
    return this.catalog.map(({ activationId: _activationId, ...entry }) => ({
      ...entry,
      installed: entry.systemDefault || installed.has(entry.pluginId),
    }))
  }
  async install(input: { userId: string; pluginId: string }): Promise<AccountPluginView> {
    const entry = this.entry(input.pluginId)
    if (!entry.systemDefault) {
      const store = await this.openStore()
      store.install(input.userId, input.pluginId)
    }
    const { activationId: _activationId, ...view } = entry
    return { ...view, installed: true }
  }
  async uninstall(input: { userId: string; pluginId: string }): Promise<AccountPluginView> {
    const entry = this.entry(input.pluginId)
    if (entry.systemDefault) throw new PluginFactoryError('PLUGIN_DEFAULT', `system plugin cannot be uninstalled: ${input.pluginId}`)
    const store = await this.openStore(); store.uninstall(input.userId, input.pluginId)
    const { activationId: _activationId, ...view } = entry
    return { ...view, installed: false }
  }
  async composition(input: { userId: string }): Promise<PluginCatalogEntry[]> {
    const installed = (await this.openStore()).installed(input.userId)
    return this.catalog.filter(entry => entry.systemDefault || installed.has(entry.pluginId))
  }
  async selected(input: { userId: string }): Promise<string[]> {
    const installed = (await this.openStore()).installed(input.userId)
    return this.catalog.filter(entry => !entry.systemDefault && installed.has(entry.pluginId)).map(entry => entry.pluginId)
  }
  private activationsForIds(pluginIds: readonly string[]): PluginActivator[] {
    const selected = new Set<string>()
    for (const pluginId of pluginIds) {
      if (typeof pluginId !== 'string' || selected.has(pluginId)) {
        throw new PluginFactoryError('PLUGIN_NOT_FOUND', `invalid durable plugin selection: ${pluginId}`)
      }
      const entry = this.entry(pluginId)
      if (entry.systemDefault) throw new PluginFactoryError('PLUGIN_DEFAULT', `system plugin cannot be selected: ${pluginId}`)
      selected.add(pluginId)
    }
    const result: PluginActivator[] = []
    for (const entry of this.catalog) {
      if (!entry.systemDefault && !selected.has(entry.pluginId)) continue
      if (entry.activationId === undefined) continue
      const activate = this.activators[entry.activationId]
      if (activate === undefined) throw new PluginFactoryError('PLUGIN_NOT_FOUND', `unknown plugin activator: ${entry.activationId}`)
      result.push(activate)
    }
    return result
  }
  async activations(input: { userId: string }): Promise<PluginActivator[]> {
    return this.activationsForIds(await this.selected(input))
  }
  activationsFor(input: { pluginIds: readonly string[] }): PluginActivator[] {
    return this.activationsForIds(input.pluginIds)
  }
  private selectionFromEvents(events: readonly SessionEvent[]): string[] {
    let selected: string[] | undefined
    for (const event of events) {
      if (event.type !== 'account-plugins/selected') continue
      if (selected !== undefined || !Array.isArray(event.data.pluginIds)) {
        throw new PluginFactoryError('PLUGIN_NOT_FOUND', 'invalid durable plugin selection')
      }
      selected = [...event.data.pluginIds]
    }
    return selected ?? []
  }
  activationsFromEvents(events: readonly SessionEvent[]): PluginActivator[] {
    return this.activationsForIds(this.selectionFromEvents(events))
  }
  selectionSeed(input: { pluginIds: readonly string[] }): SessionEvent<'account-plugins/selected'> {
    const pluginIds = [...input.pluginIds]
    this.activationsForIds(pluginIds)
    return { type: 'account-plugins/selected', seq: 0, time: Date.now(), data: { pluginIds } }
  }
}

export default LocalAccountPluginFactory
