import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalDirectory } from '../src/main/directory-import'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-import-'))
  roots.push(root)
  return root
}

describe('readLocalDirectory', () => {
  it('serializes nested Unicode files as relative base64 entries', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, '子目录'))
    await writeFile(join(root, '子目录', '你好.txt'), 'hello')
    await expect(readLocalDirectory(root)).resolves.toMatchObject({ files: [{ path: '子目录/你好.txt', content: 'aGVsbG8=' }] })
  })

  it('rejects symbolic links', async () => {
    const root = await temporaryRoot()
    await writeFile(join(root, 'real.txt'), 'x')
    await symlink(join(root, 'real.txt'), join(root, 'link.txt'))
    await expect(readLocalDirectory(root)).rejects.toThrow('符号链接')
  })
})
