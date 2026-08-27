/** Artifact failure class. @module @deepseek-ai/dsh-artifact/error */

const ARTIFACT_ADMISSION_ERROR_CODES = [
  'ARTIFACT_TOO_LARGE',
  'UNSUPPORTED_ARTIFACT_KIND',
  'UNSUPPORTED_ARTIFACT_SOURCE',
  'UNSUPPORTED_ARTIFACT_MEDIA_TYPE',
  'ARTIFACT_TOO_MANY_PER_SESSION',
  'INVALID_ARTIFACT_BYTES',
] as const

/** Caller-correctable artifact admission failures (raised at validation or persistence). */
export type ArtifactAdmissionErrorCode = typeof ARTIFACT_ADMISSION_ERROR_CODES[number]

/** Stable artifact failure codes used for protocol error routing. */
export type ArtifactErrorCode =
  | ArtifactAdmissionErrorCode
  | 'INVALID_ARTIFACT_REF'
  | 'ARTIFACT_CORRUPT'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_READ_FAILED'
  | 'ARTIFACT_WRITE_FAILED'
  | 'ARTIFACT_REMOVE_FAILED'

const ARTIFACT_ADMISSION_ERROR_CODE_SET: ReadonlySet<string> =
  new Set(ARTIFACT_ADMISSION_ERROR_CODES)

/**
 * Stable failures suitable for host RPC error mapping.
 *
 * Re-implements the shape used by the attachment seam rather than extending a
 * common base: there is no shared error package in the dependency graph yet,
 * and consumers route on `code` rather than the prototype chain, so the
 * shape is interchangeable at the wire boundary.
 */
export class ArtifactError extends Error {
  /** Stable machine-routing failure code. */
  readonly code: ArtifactErrorCode

  /**
   * @param message - human-readable failure description without raw bytes or host paths.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: ArtifactErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ArtifactError'
    this.code = code
  }
}

/**
 * Distinguish caller-correctable artifact admission failures from storage faults.
 * @param error - failure raised while validating or persisting an artifact.
 * @returns whether the caller can correct the proposed content or batch.
 */
export function isArtifactAdmissionError(
  error: unknown,
): error is ArtifactError & { readonly code: ArtifactAdmissionErrorCode } {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && ARTIFACT_ADMISSION_ERROR_CODE_SET.has(error.code)
}
