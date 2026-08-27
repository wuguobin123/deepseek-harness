import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertWorkspaceSearchPath } from '../src/search-core.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace-only search roots', () => {
  it('accepts contained roots and rejects traversal and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-search-confined-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    await mkdir(join(workspace, 'nested'), { recursive: true })
    await mkdir(outside)
    await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const exec = {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: workspace } } },
    } as never

    await expect(assertWorkspaceSearchPath(exec, 'nested')).resolves.toBeUndefined()
    await expect(assertWorkspaceSearchPath(exec, '..')).rejects.toThrow('outside the session workspace')
    await expect(assertWorkspaceSearchPath(exec, join(workspace, 'escape'))).rejects.toThrow('outside the session workspace')
  })
})
