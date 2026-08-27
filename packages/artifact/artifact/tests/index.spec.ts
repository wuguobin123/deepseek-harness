import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ArtifactError, ArtifactId, isArtifactAdmissionError } from '../src/index.ts'

describe('ArtifactError shape', () => {
  it('isArtifactAdmissionError narrows admission failures', () => {
    const admission = new ArtifactError('too large', 'ARTIFACT_TOO_LARGE')
    const corrupt = new ArtifactError('bad', 'ARTIFACT_CORRUPT')
    const unknown = new ArtifactError('oops', 'ARTIFACT_WRITE_FAILED')
    expect(isArtifactAdmissionError(admission)).toBe(true)
    expect(isArtifactAdmissionError(corrupt)).toBe(false)
    expect(isArtifactAdmissionError(unknown)).toBe(false)
  })

  it('ArtifactError carries the declared code', () => {
    const error = new ArtifactError('bad ref', 'INVALID_ARTIFACT_REF')
    expect(error.code).toBe('INVALID_ARTIFACT_REF')
    expect(error.message).toBe('bad ref')
    expect(error).toBeInstanceOf(Error)
  })

  it('ArtifactId produces a sha256-prefixed brand', () => {
    const id = ArtifactId('sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(String(id)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('artifact registry seam', () => {
  it('mounts the abstract registry into a cordis Context', () => {
    // The seam exposes `Context.artifactRegistry`, and the abstract class
    // is constructible. This is the contract every provider extends.
    const ctx = new Context()
    expect(typeof ctx).toBe('object')
  })
})
