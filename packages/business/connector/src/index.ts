/** Approved connector capability used by business Skill execution. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BusinessOperation } from '@deepseek-ai/dsh-business-skill'

/** Trusted identity derived from the authenticated Session, never model input. */
export interface BusinessPrincipal {
  readonly userId: string
  readonly tenantId?: string
}

/** Per-operation credential lookup; implementations must not cache values. */
export interface CredentialResolver {
  resolve(ref: string): Promise<string | undefined>
}

/** One connector call after manifest and runtime policy checks. */
export interface ConnectorRequest {
  readonly operation: BusinessOperation
  readonly input: unknown
  readonly principal: BusinessPrincipal
  readonly credential?: string
  /** Correlation id propagated to the downstream business service. */
  readonly traceId?: string
  readonly signal?: AbortSignal
}

/** Controlled business transport selected by a manifest connection id. */
export interface BusinessConnector {
  readonly id: string
  readonly allowedCredentialRefs?: ReadonlySet<string>
  execute(request: ConnectorRequest): Promise<unknown>
}

/** Lazy resolver used for data-defined connection ids such as approved HTTPS URLs. */
export type BusinessConnectorResolver = (id: string) => BusinessConnector | undefined

declare module '@deepseek-ai/cordis' {
  interface Context {
    businessConnectors: BusinessConnectorRegistry
  }
}

/** Registry for named connectors and policy-constrained dynamic resolvers. */
export class BusinessConnectorRegistry extends Service {
  private readonly connectors = new Map<string, BusinessConnector>()
  private readonly resolvers = new Set<BusinessConnectorResolver>()

  constructor(ctx: Context) {
    super(ctx, 'businessConnectors')
  }

  /** Register one fixed connector.
   * @param connector - Approved connector instance.
   * @returns Disposer that removes the connector.
   */
  register(connector: BusinessConnector): () => void {
    if (this.connectors.has(connector.id)) throw new Error(`connector ${connector.id} already registered`)
    this.connectors.set(connector.id, connector)
    return () => { this.connectors.delete(connector.id) }
  }

  /** Register one constrained resolver for configuration-defined connector ids.
   * @param resolver - Policy-constrained connector resolver.
   * @returns Disposer that removes the resolver.
   */
  registerResolver(resolver: BusinessConnectorResolver): () => void {
    this.resolvers.add(resolver)
    return () => { this.resolvers.delete(resolver) }
  }

  /** Resolve a connector without exposing registry contents to manifests or models.
   * @param id - Manifest connection identifier.
   * @returns Approved connector, when one accepts the identifier.
   */
  get(id: string): BusinessConnector | undefined {
    const fixed = this.connectors.get(id)
    if (fixed !== undefined) return fixed
    for (const resolver of this.resolvers) {
      const connector = resolver(id)
      if (connector !== undefined) return connector
    }
    return undefined
  }
}

/** Mount the connector registry once in the Host composition. */
export function apply(ctx: Context): void {
  ctx.plugin(BusinessConnectorRegistry)
}

export default BusinessConnectorRegistry
