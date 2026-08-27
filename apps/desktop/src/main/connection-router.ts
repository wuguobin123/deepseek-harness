import type { ClientResponse } from '../shared/contracts'

export interface RoutedClient {
  call<T = unknown>(method: string, payload: unknown): Promise<T>
  respond(envelope: ClientResponse): Promise<void>
  streamMux(signal?: AbortSignal): AsyncIterable<unknown>
  streamHost(signal?: AbortSignal): AsyncIterable<unknown>
}

const CLOUD_ONLY = /^(account\.|userContext\.|update\.)/u

/** Selects local or cloud transport while keeping account and update traffic cloud-only. */
export class ConnectionRouter implements RoutedClient {
  private environment: 'local' | 'cloud' = 'local'
  private readonly streams = new Set<AbortController>()

  constructor(
    private readonly cloud: RoutedClient,
    private readonly local: () => RoutedClient | null,
    private readonly ensureLocal?: () => Promise<RoutedClient>,
  ) {}

  getEnvironment(): 'local' | 'cloud' {
    return this.environment
  }

  async setEnvironment(environment: 'local' | 'cloud'): Promise<void> {
    for (const controller of this.streams) controller.abort()
    this.streams.clear()
    if (environment === 'local' && this.local() === null && this.ensureLocal) {
      await this.ensureLocal()
    }
    this.environment = environment
  }

  private target(method: string): RoutedClient {
    if (CLOUD_ONLY.test(method)) return this.cloud
    if (this.environment === 'cloud') return this.cloud
    const local = this.local()
    if (local === null) throw new Error('本机运行时不可用，请重试或切换到云端环境')
    return local
  }

  call<T = unknown>(method: string, payload: unknown): Promise<T> {
    return this.target(method).call<T>(method, payload)
  }

  respond(envelope: ClientResponse): Promise<void> {
    return this.target('respond').respond(envelope)
  }

  streamMux(signal?: AbortSignal): AsyncIterable<unknown> {
    return this.stream('mux', signal)
  }

  streamHost(signal?: AbortSignal): AsyncIterable<unknown> {
    return this.stream('host', signal)
  }

  private stream(kind: 'mux' | 'host', signal?: AbortSignal): AsyncIterable<unknown> {
    const controller = new AbortController()
    this.streams.add(controller)
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', () => { controller.abort() }, { once: true })
    }
    let iterable: AsyncIterable<unknown>
    try {
      iterable = this.target(`stream.${kind}`)[kind === 'mux' ? 'streamMux' : 'streamHost'](controller.signal)
    } catch (error) {
      this.streams.delete(controller)
      throw error
    }
    const unregister = (): void => { this.streams.delete(controller) }
    return (async function* () {
      try {
        yield* iterable
      } finally {
        unregister()
      }
    })()
  }
}
