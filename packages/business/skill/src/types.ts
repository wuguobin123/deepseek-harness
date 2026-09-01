/** Data-only business Skill manifest and storage contracts. */
export type JsonSchema = Record<string, unknown>
/** One read-only operation declared by an account business Skill. */
export interface BusinessOperation {
  readonly id: string
  readonly method: 'GET'
  readonly path: string
  readonly input: JsonSchema
  readonly output: JsonSchema
  readonly permission: string
  readonly connection: string
  readonly credentialRef?: string
  readonly risk: 'R1'
  readonly maxResponseBytes?: number
}
/** Data-only definition published by an authenticated account. */
export interface BusinessSkillManifest {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly connectionIds: readonly string[]
  readonly credentialRefs: readonly string[]
  readonly operations: readonly BusinessOperation[]
}
/** Immutable stored revision and its active-pointer state. */
export interface SkillVersion {
  readonly ownerId: string
  readonly revision: number
  readonly manifest: BusinessSkillManifest
  readonly active: boolean
}
/** Durable provider contract for account-scoped manifest revisions. */
export interface SkillStore {
  /** Publish an immutable revision and atomically activate it. */
  publish(ownerId: string, manifest: BusinessSkillManifest, expectedRevision?: number): Promise<SkillVersion>
  /** Validate untrusted parsed manifest data. */
  validate(ownerId: string, manifest: unknown): BusinessSkillManifest
  /** List retained revisions owned by one authenticated account. */
  list(ownerId: string): Promise<readonly SkillVersion[]>
  /** Read one active or explicitly selected owned revision. */
  get(ownerId: string, skill: string, revision?: number): Promise<SkillVersion | null>
  /** Clear the active pointer for one owned Skill. */
  disable(ownerId: string, skill: string, expectedRevision?: number): Promise<void>
  /** Atomically move the active pointer to a retained revision. */
  rollback(ownerId: string, skill: string, revision: number, expectedRevision?: number): Promise<SkillVersion>
  /** Resolve the active immutable revision at dispatch. */
  resolve(ownerId: string, skill: string): Promise<SkillVersion | null>
}
/** Typed rejection raised by manifest management or execution. */
export class BusinessSkillError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'BusinessSkillError' } }
