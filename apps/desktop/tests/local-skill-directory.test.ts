import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalSkillDirectoryManager } from '../src/main/local-skill-directory'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'dsh-local-skills-')); roots.push(value); return value }
async function source(home: string, text = '---\nname: helper\ndescription: "A helper"\nmetadata:\n  category: local\nuser-invocable: true\n---\n\nInstructions\n\n---\n\nMore instructions\n'): Promise<string> {
  const value = join(home, 'source'); await mkdir(value); await writeFile(join(value, 'SKILL.md'), text); return value
}

describe('LocalSkillDirectoryManager', () => {
  it('installs nested files, skips .git, and is idempotent', async () => {
    const home = await root(); const input = await source(home)
    await mkdir(join(input, 'nested')); await writeFile(join(input, 'nested', 'note.txt'), 'hello')
    await mkdir(join(input, '.git')); await writeFile(join(input, '.git', 'secret'), 'ignored')
    const manager = new LocalSkillDirectoryManager({ dshHome: join(home, 'dsh') })
    await expect(manager.install(input)).resolves.toMatchObject({ status: 'installed', skill: { name: 'helper', fileCount: 2 } })
    await expect(manager.install(input)).resolves.toMatchObject({ status: 'unchanged', skill: { directoryName: 'helper' } })
    await expect(readFile(join(home, 'dsh', 'skills', 'helper', 'nested', 'note.txt'), 'utf8')).resolves.toBe('hello')
    await expect(readdir(join(home, 'dsh', 'skills', 'helper', '.git'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lists valid and invalid directories without paths', async () => {
    const home = await root(); const manager = new LocalSkillDirectoryManager({ dshHome: join(home, 'dsh') }); const input = await source(home)
    await manager.install(input); await mkdir(join(home, 'dsh', 'skills', 'broken')); await writeFile(join(home, 'dsh', 'skills', 'broken', 'SKILL.md'), 'not frontmatter')
    const records = await manager.list(); expect(records).toEqual([{ directoryName: 'broken', valid: false, fileCount: 1, totalBytes: 15, error: expect.any(String) }, { directoryName: 'helper', name: 'helper', description: 'A helper', valid: true, fileCount: 1, totalBytes: expect.any(Number) }]); expect(JSON.stringify(records)).not.toContain(home)
  })

  it('rejects links and conflicting content', async () => {
    const home = await root(); const input = await source(home); const manager = new LocalSkillDirectoryManager({ dshHome: join(home, 'dsh') })
    await symlink(join(home, 'outside'), join(input, 'linked'))
    await expect(manager.install(input)).rejects.toThrow('link')
    await unlink(join(input, 'linked')); await writeFile(join(input, 'linked'), 'different')
    await manager.install(input)
    await writeFile(join(input, 'SKILL.md'), '---\nname: helper\ndescription: changed\n---\n\nnew\n')
    await expect(manager.install(input)).rejects.toThrow('different content')
  })

  it('keeps private modes and executable bits', async () => {
    const home = await root(); const input = await source(home); await writeFile(join(input, 'run.sh'), '#!/bin/sh\n'); await chmod(join(input, 'run.sh'), 0o755)
    const manager = new LocalSkillDirectoryManager({ dshHome: join(home, 'dsh') }); await manager.install(input)
    expect((await stat(join(home, 'dsh', 'skills'))).mode & 0o777).toBe(0o700); expect((await stat(join(home, 'dsh', 'skills', 'helper', 'run.sh'))).mode & 0o777).toBe(0o700)
  })

  it('rejects bounded-work and metadata failures without staging residue or private paths', async () => {
    const home = await root()
    const input = await source(home)
    await writeFile(join(input, 'oversized.bin'), Buffer.alloc(5 * 1024 * 1024 + 1))
    const manager = new LocalSkillDirectoryManager({ dshHome: join(home, 'dsh') })
    await expect(manager.install(input)).rejects.toThrow('Skill file exceeds')
    await expect(readdir(join(home, 'dsh', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(join(input, 'oversized.bin'))
    await writeFile(join(input, 'SKILL.md'), '---\nname: Not Safe\ndescription: broken\n---\n')
    await expect(manager.install(input)).rejects.toThrow('invalid skill name')
    await expect(manager.install(join(home, 'missing-private-directory'))).rejects.not.toThrow(home)
  })
})
