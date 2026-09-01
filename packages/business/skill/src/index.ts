/** Service Definition for account-scoped, data-only business Skills. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BusinessSkillManifest, SkillStore, SkillVersion } from './types.ts'
import { BusinessSkillError } from './types.ts'

export * from './types.ts'

/** Cordis plugin name. */
export const name = 'business-skill'
declare module '@deepseek-ai/cordis' {
  interface Context {
    businessSkill: BusinessSkillService
  }
}

/** Account-owned manifest registry with one replaceable storage provider. */
export class BusinessSkillService extends Service {
  private store: SkillStore | undefined

  constructor(ctx: Context) {
    super(ctx, 'businessSkill')
  }

  /** Bind one durable provider for this service lifetime.
   * @param store - Durable provider implementation.
   * @returns Disposer that removes the provider.
   */
  registerProvider(store: SkillStore): () => void {
    if (this.store !== undefined) {
      throw new BusinessSkillError('DUPLICATE_PROVIDER', 'business Skill provider already registered')
    }
    this.store = store
    return () => {
      if (this.store === store) this.store = undefined
    }
  }

  private get provider(): SkillStore {
    if (this.store === undefined) {
      throw new BusinessSkillError('PROVIDER_UNAVAILABLE', 'business Skill provider is unavailable')
    }
    return this.store
  }

  /** Validate parsed manifest data for an owner.
   * @param ownerId - Trusted account owner.
   * @param manifest - Parsed untrusted manifest data.
   * @returns Validated manifest.
   */
  validate(ownerId: string, manifest: unknown): BusinessSkillManifest {
    return this.provider.validate(ownerId, manifest)
  }

  /** Publish and activate an immutable revision.
   * @param ownerId - Trusted account owner.
   * @param manifest - Validated manifest.
   * @param expectedRevision - Optional compare-and-swap revision.
   * @returns Published active revision.
   */
  publish(ownerId: string, manifest: BusinessSkillManifest, expectedRevision?: number): Promise<SkillVersion> {
    return this.provider.publish(ownerId, manifest, expectedRevision)
  }

  /** List retained revisions for an owner.
   * @param ownerId - Trusted account owner.
   * @returns Owned revisions.
   */
  list(ownerId: string): Promise<readonly SkillVersion[]> {
    return this.provider.list(ownerId)
  }

  /** Read one owned revision.
   * @param ownerId - Trusted account owner.
   * @param skill - Skill name.
   * @param revision - Optional immutable revision; the active revision otherwise.
   * @returns Selected revision or null.
   */
  get(ownerId: string, skill: string, revision?: number): Promise<SkillVersion | null> {
    return this.provider.get(ownerId, skill, revision)
  }

  /** Disable one owned Skill.
   * @param ownerId - Trusted account owner.
   * @param skill - Skill name.
   * @param expectedRevision - Optional compare-and-swap revision.
   */
  disable(ownerId: string, skill: string, expectedRevision?: number): Promise<void> {
    return this.provider.disable(ownerId, skill, expectedRevision)
  }

  /** Activate one retained revision.
   * @param ownerId - Trusted account owner.
   * @param skill - Skill name.
   * @param revision - Retained revision to activate.
   * @param expectedRevision - Optional compare-and-swap active revision.
   * @returns Newly active retained revision.
   */
  rollback(ownerId: string, skill: string, revision: number, expectedRevision?: number): Promise<SkillVersion> {
    return this.provider.rollback(ownerId, skill, revision, expectedRevision)
  }

  /** Resolve the current active revision for dispatch.
   * @param ownerId - Trusted account owner.
   * @param skill - Skill name.
   * @returns Active revision or null.
   */
  resolve(ownerId: string, skill: string): Promise<SkillVersion | null> {
    return this.provider.resolve(ownerId, skill)
  }
}

export default BusinessSkillService
