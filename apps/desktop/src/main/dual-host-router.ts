import type { ClientResponse } from '../shared/contracts'
import type { RpcMethodMap } from '@deepseek-ai/dsh-host-apiproxy'
import { decodeResourceId, encodeResourceId, findResourceLocation, stripResourceIds, type HostLocation } from './resource-codec'
import type { RoutedClient } from './connection-router'

const AGGREGATE_METHODS = ['workspace.list', 'session.list', 'session.search', 'host.describe'] as const
const CLOUD_ONLY_METHODS = [
  'workspace.importDirectory',
  'account.signup', 'account.emailCode', 'account.invites.create', 'account.invites.list',
  'account.invites.rotate', 'account.signin', 'account.signout', 'account.state',
  'account.wallet.get', 'account.wallet.credit', 'account.wallet.debit', 'account.wallet.setQuota',
  'account.wallet.refreshDaily', 'account.wallet.grantWelcomeBonus', 'account.wallet.listLedger',
  'account.modelKeys.provision', 'account.modelKeys.list', 'account.modelKeys.revoke',
  'account.customModels.create', 'account.customModels.list', 'account.customModels.remove',
  'account.plugins.list', 'account.plugins.install', 'account.plugins.uninstall',
  'userContext.list', 'userContext.get', 'userContext.set', 'userContext.delete',
] as const
const RESOURCE_OR_CLOUD_METHODS = [
  'session.create', 'session.history', 'session.models', 'session.selectModel', 'session.rename',
  'session.fork', 'session.prompt', 'session.attachment', 'session.updateQueue', 'session.cancel',
  'subagent.list', 'subagent.history', 'subagent.prompt', 'subagent.interrupt',
  'host.pickDirectory', 'host.listDirectory', 'host.createDirectory', 'host.openPath',
  'workspace.rename', 'workspace.delete', 'workspace.insertBefore', 'workspace.insertSessionBefore',
  'workspace.archiveSession', 'skill.list',
  'agentPreset.list', 'agentPreset.select', 'agentPreset.read', 'agentPreset.copy',
  'agentPreset.openDocument', 'agentPreset.remove',
  'goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear',
  'settings.describe', 'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
  'credentials.describe', 'credentials.set', 'credentials.unset',
  'llm.providers', 'llm.models', 'llm.discoverModels',
  'artifact.list', 'artifact.read', 'artifact.remove',
] as const
const EXPLICIT_LOCATION_METHODS = ['workspace.create'] as const

type ClassifiedMethod =
  | typeof AGGREGATE_METHODS[number]
  | typeof CLOUD_ONLY_METHODS[number]
  | typeof RESOURCE_OR_CLOUD_METHODS[number]
  | typeof EXPLICIT_LOCATION_METHODS[number]
type MissingMethod = Exclude<keyof RpcMethodMap, ClassifiedMethod>
type UnknownMethod = Exclude<ClassifiedMethod, keyof RpcMethodMap>
const ROUTE_PARTITION_IS_EXHAUSTIVE: [MissingMethod, UnknownMethod] extends [never, never] ? true : never = true
void ROUTE_PARTITION_IS_EXHAUSTIVE

const AGGREGATE: ReadonlySet<string> = new Set(AGGREGATE_METHODS)
const CLOUD_ONLY: ReadonlySet<string> = new Set(CLOUD_ONLY_METHODS)
const RESOURCE_OR_CLOUD: ReadonlySet<string> = new Set(RESOURCE_OR_CLOUD_METHODS)
const EXPLICIT_LOCATION: ReadonlySet<string> = new Set(EXPLICIT_LOCATION_METHODS)

/** Fail-closed ownership class for one wire method. */
export type RpcHostPolicy = 'aggregate' | 'cloud' | 'resource' | 'explicit'

/** Return the declared Host ownership policy, or undefined for an unknown method. */
export function rpcHostPolicy(method: string): RpcHostPolicy | undefined {
  if (AGGREGATE.has(method)) return 'aggregate'
  if (CLOUD_ONLY.has(method)) return 'cloud'
  if (RESOURCE_OR_CLOUD.has(method)) return 'resource'
  if (EXPLICIT_LOCATION.has(method)) return 'explicit'
  return undefined
}

/** Routes location-bearing RPCs to two independent Hosts. */
export class DualHostRouter implements RoutedClient {
  constructor(
    private readonly cloud: RoutedClient,
    private readonly local: () => RoutedClient | null,
    private readonly ensureLocal?: () => Promise<RoutedClient>,
  ) {}

  /** Compatibility no-op: federation never reloads or changes global ownership. */
  async setEnvironment(_environment: HostLocation): Promise<void> {}

  /** Retained for callers migrating from the former global selector. */
  getEnvironment(): HostLocation { return 'cloud' }

  private async client(location: HostLocation): Promise<RoutedClient> {
    if (location === 'cloud') return this.cloud
    const local = this.local()
    if (local !== null) return local
    if (this.ensureLocal) return this.ensureLocal()
    throw new Error('本机运行时不可用，请重试')
  }

  async call<T = unknown>(method: string, payload: unknown): Promise<T> {
    const policy = rpcHostPolicy(method)
    if (policy === 'aggregate') return this.aggregate<T>(method, payload)
    const explicit = payload !== null && typeof payload === 'object' && (payload as Record<string, unknown>).location
    let location: HostLocation | undefined
    if (policy === 'cloud') location = 'cloud'
    else if (explicit === 'local' || explicit === 'cloud') location = explicit
    else if (policy === 'resource') location = findResourceLocation(payload) ?? 'cloud'
    if (location === undefined) throw new Error(`RPC method ${method} is unclassified or requires an explicit Host location`)
    const host = await this.client(location)
    const request = payload !== null && typeof payload === 'object'
      ? Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([key]) => key !== 'location'))
      : payload
    return host.call<T>(method, stripResourceIds(request, location))
      .then(value => policy === 'cloud' ? value : this.tagResult(location, value))
  }

  private async aggregate<T>(method: string, payload: unknown): Promise<T> {
    const [cloud, local] = await Promise.allSettled([
      this.cloud.call<unknown>(method, payload),
      this.client('local').then(host => host.call(method, payload)),
    ])
    const cloudResult = cloud.status === 'fulfilled' ? cloud.value : undefined
    const localResult = local.status === 'fulfilled' ? local.value : undefined
    if (cloud.status === 'rejected' && local.status === 'rejected') {
      throw new AggregateError([cloud.reason, local.reason], `both Hosts failed ${method}`)
    }
    if (method === 'host.describe') return (cloudResult ?? localResult) as T
    if (method === 'workspace.list' || method === 'session.list') {
      const cloudRecord = cloudResult !== null && typeof cloudResult === 'object' ? cloudResult as Record<string, unknown> : {}
      const localRecord = localResult !== null && typeof localResult === 'object' ? localResult as Record<string, unknown> : {}
      return {
        ...cloudRecord,
        items: [...this.tagList('cloud', cloudRecord.items), ...this.tagList('local', localRecord.items)],
        archivedSessionIds: [
          ...(Array.isArray(cloudRecord.archivedSessionIds) ? cloudRecord.archivedSessionIds : []).map(id => typeof id === 'string' ? encodeResourceId('cloud', id) : id),
          ...(Array.isArray(localRecord.archivedSessionIds) ? localRecord.archivedSessionIds : []).map(id => typeof id === 'string' ? encodeResourceId('local', id) : id),
        ],
      } as T
    }
    if (method === 'session.search') {
      const cloudRecord = cloudResult !== null && typeof cloudResult === 'object' ? cloudResult as Record<string, unknown> : {}
      const localRecord = localResult !== null && typeof localResult === 'object' ? localResult as Record<string, unknown> : {}
      return {
        items: [...this.tagList('cloud', cloudRecord.items), ...this.tagList('local', localRecord.items)],
        hasMore: cloudRecord.hasMore === true || localRecord.hasMore === true,
      } as T
    }
    return [...this.tagList('cloud', cloudResult), ...this.tagList('local', localResult)] as T
  }

  private tagList(location: HostLocation, value: unknown): unknown[] {
    if (Array.isArray(value)) return value.map(item => this.tagResult(location, item))
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['workspaces', 'sessions', 'items']) {
        if (Array.isArray(record[key])) return record[key].map(item => this.tagResult(location, item))
      }
    }
    return value === undefined ? [] : [this.tagResult(location, value)]
  }

  private tagResult<T>(location: HostLocation, value: T): T {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => this.tagResult(location, item)) as T
    const record = value as Record<string, unknown>
    const output: Record<string, unknown> = { ...record }
    for (const [key, item] of Object.entries(output)) {
      const isOwnedId = key === 'questionRpcId' || /(?:workspace|session|artifact|approval)Id$/iu.test(key)
      const isOwnedIds = /(?:workspace|session|artifact|approval)Ids$/iu.test(key)
      if (isOwnedId && typeof item === 'string' && !item.startsWith('dsh:')) output[key] = encodeResourceId(location, item)
      else if (isOwnedIds && Array.isArray(item)) output[key] = item.map(id => typeof id === 'string' && !id.startsWith('dsh:') ? encodeResourceId(location, id) : id)
      else if (item !== null && typeof item === 'object') output[key] = this.tagResult(location, item)
    }
    return output as T
  }

  respond(envelope: ClientResponse): Promise<void> {
    const location = findResourceLocation(envelope) ?? 'cloud'
    const rpcId = stripResourceIds(envelope.rpcId, location)
    if (typeof rpcId !== 'string') throw new Error('response rpcId must remain a string')
    return this.client(location).then(host => host.respond({ ...envelope, rpcId, result: envelope.result.ok
      ? { ...envelope.result, value: stripResourceIds(envelope.result.value, location) }
      : envelope.result }))
  }

  streamMux(signal?: AbortSignal): AsyncIterable<unknown> { return this.merge('streamMux', signal) }
  streamHost(signal?: AbortSignal): AsyncIterable<unknown> { return this.merge('streamHost', signal) }

  private async *merge(kind: 'streamMux' | 'streamHost', signal?: AbortSignal): AsyncGenerator<unknown> {
    type Source = { location: HostLocation; iterator: AsyncIterator<unknown> }
    type Next = { source: Source; result: IteratorResult<unknown> }
    const cloud: Source = { location: 'cloud', iterator: this.cloud[kind](signal)[Symbol.asyncIterator]() }
    const pending = new Map<HostLocation, Promise<Next>>()
    const schedule = (source: Source): void => {
      pending.set(source.location, source.iterator.next()
        .then(result => ({ source, result }))
        .catch(() => ({ source, result: { done: true, value: undefined } })))
    }
    schedule(cloud)
    pending.set('local', this.client('local')
      .then((host) => {
        const source: Source = { location: 'local', iterator: host[kind](signal)[Symbol.asyncIterator]() }
        return source.iterator.next().then(result => ({ source, result }))
      })
      .catch(() => ({
        source: { location: 'local', iterator: { next: async () => ({ done: true, value: undefined }) } },
        result: { done: true, value: undefined },
      })))
    while (pending.size > 0) {
      const next = await Promise.race(pending.values())
      pending.delete(next.source.location)
      if (next.result.done) continue
      const frame = this.tagResult(next.source.location, next.result.value)
      if (frame !== null && typeof frame === 'object') {
        const envelope = frame as Record<string, unknown>
        if (typeof envelope.rpcId === 'string' && !envelope.rpcId.startsWith('dsh:')) envelope.rpcId = encodeResourceId(next.source.location, envelope.rpcId)
      }
      yield frame
      schedule(next.source)
    }
  }
}

export { decodeResourceId, encodeResourceId }
