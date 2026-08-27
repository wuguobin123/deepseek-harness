/**
 * sanity-artifact-roundtrip.mjs
 *
 * End-to-end probe for the ArtifactRegistry seam: compose a minimal Cordis
 * context with @deepseek-ai/dsh-artifact-store-fs mounted under a temporary
 * DSH_HOME, write one HTML payload, list, read, and remove it; assert the
 * sha256 round-trips and the durable bytes match what was submitted.
 *
 * Used by the xiaowei CI gate to confirm the artifact stack still stands
 * up on the wire that the Renderer (ui-artifact) and tools (tool-html,
 * tool-slides, tool-doc, tool-sheet, tool-chart) all consume.
 *
 * Run with: `node scripts/xiaowei/sanity-artifact-roundtrip.mjs` from the
 * repo root, or via `pnpm exec tsx scripts/xiaowei/sanity-artifact-roundtrip.mjs`
 * if the script is upgraded to TS. This file is plain ESM so it ships in the
 * xiaowei sanity lane without tsx.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { LocalArtifactRegistry } from '@deepseek-ai/dsh-artifact-store-fs'

/** Format a one-line failure summary and bail. */
function die(reason) {
  console.error(`sanity-artifact-roundtrip: FAIL — ${reason}`)
  process.exit(1)
}

/** Compute the sha256 hex digest of one byte buffer. */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-artifact-'))
  const root = join(home, 'artifacts', 'v1')
  console.log(`sanity-artifact-roundtrip: home=${home}`)

  const ctx = new Context()
  await ctx.plugin(LocalArtifactRegistry, { dshHome: home })
  const registry = ctx.artifactRegistry

  // Step 1: write
  const payload = new TextEncoder().encode(
    `<!doctype html><meta charset="utf-8"><title>sanity</title><p>hello ${randomUUID()}</p>`,
  )
  const expectedSha = sha256Hex(payload)
  const createdAt = new Date().toISOString()
  const view = await registry.write({
    data: payload,
    kind: 'html',
    source: 'tool-html',
    mediaType: 'text/html',
    name: 'sanity.html',
    title: 'sanity',
  })
  if (String(view.artifactId) !== `sha256:${expectedSha}`) {
    await rm(home, { recursive: true, force: true })
    die(`write digest mismatch: ${view.artifactId} vs sha256:${expectedSha}`)
  }
  if (view.bytes !== payload.byteLength) {
    await rm(home, { recursive: true, force: true })
    die(`write bytes mismatch: ${view.bytes} vs ${payload.byteLength}`)
  }
  if (view.createdAt !== createdAt) {
    // The registry mints its own createdAt, not the caller; that is the
    // contract. We assert it is parseable rather than equal.
    if (Number.isNaN(Date.parse(view.createdAt))) {
      await rm(home, { recursive: true, force: true })
      die(`createdAt is not ISO-8601: ${view.createdAt}`)
    }
  }
  console.log(`sanity-artifact-roundtrip: wrote ${view.artifactId} (${view.bytes} bytes)`)

  // Step 2: verify the disk layout (object + sidecar)
  const bucket = expectedSha.slice(0, 2)
  const objectPath = join(root, 'objects', bucket, expectedSha)
  const metaPath = join(root, 'meta', `${expectedSha}.meta.json`)
  try {
    const objectStat = await stat(objectPath)
    const metaStat = await stat(metaPath)
    if (objectStat.size !== payload.byteLength) {
      await rm(home, { recursive: true, force: true })
      die(`object size mismatch on disk: ${objectStat.size} vs ${payload.byteLength}`)
    }
    if (metaStat.size === 0) {
      await rm(home, { recursive: true, force: true })
      die(`sidecar is empty: ${metaPath}`)
    }
  } catch (error) {
    await rm(home, { recursive: true, force: true })
    die(`disk layout missing (${error.code ?? error.message})`)
  }

  // Step 3: list
  const listed = await registry.list()
  if (listed.length !== 1 || String(listed[0].artifactId) !== String(view.artifactId)) {
    await rm(home, { recursive: true, force: true })
    die(`list mismatch: got ${JSON.stringify(listed.map(v => v.artifactId))}`)
  }
  console.log(`sanity-artifact-roundtrip: list returned 1 row`)

  // Step 4: read and verify digest
  const back = await registry.read({ artifactId: view.artifactId })
  const backSha = sha256Hex(back.data)
  if (backSha !== expectedSha) {
    await rm(home, { recursive: true, force: true })
    die(`read digest mismatch: ${backSha} vs ${expectedSha}`)
  }
  if (new TextDecoder().decode(back.data) !== new TextDecoder().decode(payload)) {
    await rm(home, { recursive: true, force: true })
    die('read bytes do not match submitted payload')
  }
  console.log('sanity-artifact-roundtrip: read verified digest and bytes')

  // Step 5: remove
  await registry.remove({ artifactId: view.artifactId })
  const after = await registry.list()
  if (after.length !== 0) {
    await rm(home, { recursive: true, force: true })
    die(`remove did not unlist: still ${after.length} rows`)
  }
  console.log('sanity-artifact-roundtrip: remove cleared the listing')

  // Cleanup
  await rm(home, { recursive: true, force: true })
  console.log('sanity-artifact-roundtrip: PASS')
}

main().catch((error) => {
  console.error('sanity-artifact-roundtrip: FAIL — unexpected throw')
  console.error(error)
  process.exit(1)
})