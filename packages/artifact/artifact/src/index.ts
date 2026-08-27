/** Durable artifact registry seam (`ctx.artifactRegistry`). @module @deepseek-ai/dsh-artifact */

import { Context, Service } from '@deepseek-ai/cordis'
import { ArtifactError } from './error.ts'
import type {
  ArtifactLimits,
  ArtifactView,
  StoredArtifact,
  WriteArtifactInput,
} from './types.ts'

export { ArtifactId } from './brand.ts'
export { ArtifactError, isArtifactAdmissionError } from './error.ts'
export type { ArtifactAdmissionErrorCode, ArtifactErrorCode } from './error.ts'
export type {
  ArtifactId as ArtifactIdType,
  ArtifactKind,
  ArtifactLimits,
  ArtifactMediaType,
  ArtifactRef,
  ArtifactSource,
  ArtifactView,
  StoredArtifact,
  WriteArtifactInput,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    artifactRegistry: ArtifactRegistry
  }
}

/**
 * Durable, content-addressed artifact registry.
 *
 * Implementations validate bytes before publishing a reference, dedup on the
 * sha256 digest (so two writes with identical bytes share one storage
 * object), and verify reference + bytes on every read.
 */
export abstract class ArtifactRegistry extends Service {
  constructor(ctx: Context) {
    super(ctx, 'artifactRegistry')
  }

  /** Deployment-resolved admission policy applied at write time. */
  abstract readonly limits: ArtifactLimits

  /**
   * Validate one artifact without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, kind, source, declared media type, and metadata.
   * @returns completion after admission has fully decoded and verified the bytes.
   */
  abstract validate(input: WriteArtifactInput): Promise<void>

  /** Validate one ordered artifact batch before committing any member. */
  protected validateBatch(inputs: readonly WriteArtifactInput[]): void {
    const { maxArtifactsPerSession, maxArtifactBytes, mediaTypes } = this.limits
    if (inputs.length > maxArtifactsPerSession) {
      throw new ArtifactError(
        'Artifact batch exceeds the configured artifact-count limit.',
        'ARTIFACT_TOO_MANY_PER_SESSION',
      )
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxArtifactBytes) {
      throw new ArtifactError(
        'Artifact batch exceeds the configured aggregate byte limit.',
        'ARTIFACT_TOO_LARGE',
      )
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new ArtifactError(
          `Artifact media type ${input.mediaType} is not accepted by this deployment.`,
          'UNSUPPORTED_ARTIFACT_MEDIA_TYPE',
        )
      }
    }
  }

  /**
   * Validate and durably commit one ordered artifact batch.
   *
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may
   * stay unreachable until a future retention policy collects them.
   * @param inputs - artifacts in their owning-message order.
   * @returns durable references in the exact input order.
   */
  async writeMany(inputs: readonly WriteArtifactInput[]): Promise<readonly ArtifactView[]> {
    this.validateBatch(inputs)
    for (const input of inputs) await this.validate(input)
    const views: ArtifactView[] = []
    for (const input of inputs) views.push(await this.write(input))
    return views
  }

  /**
   * Validate and durably commit one artifact before its owning session event
   * is appended. The returned view describes the persisted artifact and
   * indexes it under the calling workspace + session when supplied.
   * @param input - encoded bytes, kind, source, declared media type, and metadata.
   * @returns the durable content-addressed artifact view.
   */
  abstract write(input: WriteArtifactInput): Promise<ArtifactView>

  /**
   * Read one artifact and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and full durable view.
   * @throws the signal reason when aborted, or an {@link ArtifactError} when verification fails.
   */
  abstract read(ref: { readonly artifactId: ArtifactView['artifactId'] }, signal?: AbortSignal): Promise<StoredArtifact>

  /**
   * List durable artifact views under optional ownership filters. The session
   * filter narrows the listing to one session; the workspace filter narrows
   * to one workspace; both omitted lists the entire deployment root.
   * @param filter - workspace and/or session ownership filter; both omitted is unfiltered.
   * @returns durable artifact views in newest-first order.
   */
  abstract list(filter?: {
    readonly workspaceId?: ArtifactView['workspaceId']
    readonly sessionId?: ArtifactView['sessionId']
  }): Promise<readonly ArtifactView[]>

  /**
   * Remove one artifact from the durable index. Content-addressed bytes may
   * remain on disk until a future retention sweep collects unreferenced
   * objects; a removed artifactId is gone from the listing and unreadable.
   * @param ref - durable reference to remove.
   */
  abstract remove(ref: { readonly artifactId: ArtifactView['artifactId'] }): Promise<void>
}

export default ArtifactRegistry
