/** Artifact identifier brand. @module @deepseek-ai/dsh-artifact/brand */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque content-addressed identifier for one immutable artifact object. */
export type ArtifactId = Branded<'ArtifactId'>

/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
export function ArtifactId(value: string): ArtifactId {
  return value as ArtifactId
}
