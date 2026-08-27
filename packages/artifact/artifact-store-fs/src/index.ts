/** Local durable artifact registry rooted below `DSH_HOME`. @module @deepseek-ai/dsh-artifact-store-fs */

import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ArtifactRegistry, ArtifactError } from '@deepseek-ai/dsh-artifact'
import type {
  ArtifactLimits,
  ArtifactView,
  StoredArtifact,
  WriteArtifactInput,
} from '@deepseek-ai/dsh-artifact'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  commitPreparedArtifact,
  listArtifactFiles,
  prepareArtifact,
  readArtifactFile,
  removeArtifactFile,
  validateArtifactBytes,
} from './store.ts'

export {
  commitPreparedArtifact,
  listArtifactFiles,
  META_SUFFIX,
  prepareArtifact,
  readArtifactFile,
  removeArtifactFile,
  saveArtifactFile,
  validateArtifactBytes,
} from './store.ts'
export type { PreparedArtifact } from './store.ts'

/** Default maximum encoded bytes for one submitted artifact; oversized sources are refused. */
export const DEFAULT_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
/** Default maximum artifacts one session may publish before rotation. */
export const DEFAULT_MAX_ARTIFACTS_PER_SESSION = 256
/** Default long-edge byte budget for one stored content-addressed object. */
export const DEFAULT_MAX_OBJECT_BYTES = 32 * 1024 * 1024

/** Local artifact registry configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one artifact write. Default: 32 MiB. */
  maxArtifactBytes?: number
  /** Maximum artifacts one session may publish before rotation. Default: 256. */
  maxArtifactsPerSession?: number
  /** Maximum encoded bytes retained on disk per content-addressed object. Default: 32 MiB. */
  maxObjectBytes?: number
}

/** Persistent content-addressed local artifact registry. */
export class LocalArtifactRegistry extends ArtifactRegistry {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxArtifactBytes: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACT_BYTES),
    maxArtifactsPerSession: z.number().step(1).min(1).default(DEFAULT_MAX_ARTIFACTS_PER_SESSION),
    maxObjectBytes: z.number().step(1).min(1).default(DEFAULT_MAX_OBJECT_BYTES),
  })

  /** Absolute versioned storage root. */
  readonly root: string
  readonly limits: ArtifactLimits
  /** Maximum encoded bytes retained per object. */
  readonly maxObjectBytes: number

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = resolve(join(resolveDshHome(config.dshHome), 'artifacts', 'v1'))
    this.limits = Object.freeze({
      maxArtifactBytes: config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
      maxArtifactsPerSession: config.maxArtifactsPerSession ?? DEFAULT_MAX_ARTIFACTS_PER_SESSION,
      mediaTypes: Object.freeze([
        'text/html',
        'text/markdown',
        'image/svg+xml',
        'image/png',
        'image/jpeg',
        'application/pdf',
      ] as const),
    })
    this.maxObjectBytes = config.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES
  }

  async validate(input: WriteArtifactInput): Promise<void> {
    await validateArtifactBytes(input, this.limits)
  }

  async write(input: WriteArtifactInput): Promise<ArtifactView> {
    const prepared = await prepareArtifact(input, this.limits, new Date().toISOString())
    try {
      return await commitPreparedArtifact(this.root, prepared)
    } catch (error) {
      if (error instanceof ArtifactError) throw error
      throw new ArtifactError('Unable to persist artifact.', 'ARTIFACT_WRITE_FAILED', { cause: error })
    }
  }

  async read(ref: { readonly artifactId: ArtifactView['artifactId'] }, signal?: AbortSignal): Promise<StoredArtifact> {
    const { view, data } = await readArtifactFile(this.root, ref, signal)
    return { view, data }
  }

  async list(filter?: {
    readonly workspaceId?: ArtifactView['workspaceId']
    readonly sessionId?: ArtifactView['sessionId']
  }): Promise<readonly ArtifactView[]> {
    return listArtifactFiles(this.root, {
      ...filter?.workspaceId === undefined ? {} : { workspaceId: String(filter.workspaceId) },
      ...filter?.sessionId === undefined ? {} : { sessionId: String(filter.sessionId) },
    })
  }

  async remove(ref: { readonly artifactId: ArtifactView['artifactId'] }): Promise<void> {
    await removeArtifactFile(this.root, ref)
  }
}

export default LocalArtifactRegistry
