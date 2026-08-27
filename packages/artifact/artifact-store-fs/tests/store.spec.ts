import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArtifactLimits } from '@deepseek-ai/dsh-artifact'
import { ArtifactError } from '@deepseek-ai/dsh-artifact'
import {
  commitPreparedArtifact,
  listArtifactFiles,
  prepareArtifact,
  readArtifactFile,
  removeArtifactFile,
  saveArtifactFile,
} from '../src/store.ts'

const LIMITS: ArtifactLimits = {
  maxArtifactBytes: 1024,
  maxArtifactsPerSession: 16,
  mediaTypes: ['text/html', 'image/svg+xml', 'text/markdown'],
}

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-artifact-'))
  roots.push(value)
  return join(value, 'artifacts', 'v1')
}

afterEach(async () => {
  while (roots.length > 0) {
    const value = roots.pop()
    if (value !== undefined) await rm(value, { recursive: true, force: true })
  }
})

describe('artifact-store-fs round trip', () => {
  it('persists an HTML artifact, lists it, reads it back with verification', async () => {
    const r = await root()
    const data = new TextEncoder().encode('<!doctype html><p>hi</p>')
    const created = await saveArtifactFile(r, {
      data, kind: 'html', source: 'tool-html', mediaType: 'text/html', name: 'hello.html',
    }, LIMITS, '2026-08-23T00:00:00.000Z')
    expect(created.artifactId).toBe(`sha256:${createHash('sha256').update(data).digest('hex')}`)
    expect(created.bytes).toBe(data.byteLength)
    expect(created.name).toBe('hello.html')
    expect(created.createdAt).toBe('2026-08-23T00:00:00.000Z')

    const items = await listArtifactFiles(r)
    expect(items.map(v => v.artifactId)).toEqual([created.artifactId])

    const back = await readArtifactFile(r, created)
    expect(new TextDecoder().decode(back.data)).toBe('<!doctype html><p>hi</p>')
    expect(back.view).toEqual(created)

    // Removal is idempotent and the listing drops the entry.
    await removeArtifactFile(r, created)
    expect(await listArtifactFiles(r)).toEqual([])
    await expect(readArtifactFile(r, created)).rejects.toBeInstanceOf(ArtifactError)
  })

  it('rejects an SVG payload whose root tag is missing', async () => {
    const r = await root()
    await expect(saveArtifactFile(r, {
      data: new TextEncoder().encode('not svg'),
      kind: 'chart', source: 'tool-svg', mediaType: 'image/svg+xml',
    }, LIMITS, '2026-08-23T00:00:00.000Z')).rejects.toMatchObject({ code: 'INVALID_ARTIFACT_BYTES' })
  })

  it('rejects an empty byte buffer', async () => {
    const r = await root()
    await expect(saveArtifactFile(r, {
      data: new Uint8Array(0),
      kind: 'html', source: 'tool-html', mediaType: 'text/html',
    }, LIMITS, '2026-08-23T00:00:00.000Z')).rejects.toMatchObject({ code: 'INVALID_ARTIFACT_BYTES' })
  })

  it('rejects an oversized payload', async () => {
    const r = await root()
    const data = new Uint8Array(LIMITS.maxArtifactBytes + 1)
    await expect(saveArtifactFile(r, {
      data, kind: 'html', source: 'tool-html', mediaType: 'text/html',
    }, LIMITS, '2026-08-23T00:00:00.000Z')).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' })
  })

  it('rejects an unaccepted media type', async () => {
    const r = await root()
    await expect(saveArtifactFile(r, {
      data: new TextEncoder().encode('x'),
      kind: 'html', source: 'tool-html', mediaType: 'image/png',
    }, LIMITS, '2026-08-23T00:00:00.000Z')).rejects.toMatchObject({ code: 'UNSUPPORTED_ARTIFACT_MEDIA_TYPE' })
  })

  it('honors the workspace filter in listings', async () => {
    const r = await root()
    const data1 = new TextEncoder().encode('<p>one</p>')
    const data2 = new TextEncoder().encode('<p>two</p>')
    const v1 = await saveArtifactFile(r, {
      data: data1, kind: 'html', source: 'tool-html', mediaType: 'text/html',
      workspaceId: 'ws-1' as never, sessionId: 's-1' as never,
    }, LIMITS, '2026-08-23T00:00:00.000Z')
    const v2 = await saveArtifactFile(r, {
      data: data2, kind: 'html', source: 'tool-html', mediaType: 'text/html',
      workspaceId: 'ws-2' as never, sessionId: 's-2' as never,
    }, LIMITS, '2026-08-23T00:00:01.000Z')
    const onlyWs1 = await listArtifactFiles(r, { workspaceId: 'ws-1' })
    expect(onlyWs1.map(v => v.artifactId)).toEqual([v1.artifactId])
    const onlyS2 = await listArtifactFiles(r, { sessionId: 's-2' })
    expect(onlyS2.map(v => v.artifactId)).toEqual([v2.artifactId])
    const all = await listArtifactFiles(r)
    expect(all.map(v => v.artifactId)).toEqual([v2.artifactId, v1.artifactId])
  })

  it('reports ARTIFACT_NOT_FOUND for an unknown id', async () => {
    const r = await root()
    const sha = 'a'.repeat(64)
    await expect(readArtifactFile(r, { artifactId: `sha256:${sha}` }))
      .rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
  })

  it('rejects an invalid reference', async () => {
    const r = await root()
    await expect(readArtifactFile(r, { artifactId: 'not-a-reference' }))
      .rejects.toBeInstanceOf(ArtifactError)
    await expect(readArtifactFile(r, { artifactId: 'sha256:tooshort' }))
      .rejects.toBeInstanceOf(ArtifactError)
  })

  it('reports ARTIFACT_CORRUPT when the prepared view disagrees with the bytes', async () => {
    const r = await root()
    const bytes = new TextEncoder().encode('<p>ok</p>')
    const prepared = await prepareArtifact({
      data: bytes, kind: 'html', source: 'tool-html', mediaType: 'text/html',
    }, LIMITS, '2026-08-23T00:00:00.000Z')
    // Tamper with the view: same bytes, declared view says it is shorter.
    const tampered = { ...prepared, view: { ...prepared.view, bytes: 1 } }
    await expect(commitPreparedArtifact(r, tampered)).rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('returns [] when listing from a fresh root', async () => {
    const r = await root()
    expect(await listArtifactFiles(r)).toEqual([])
  })
})
