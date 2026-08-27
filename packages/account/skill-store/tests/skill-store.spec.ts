import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionOwnerId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import LocalAccountSkillStore, { SkillInstallConflict } from '@deepseek-ai/dsh-account-skill-store'

describe('account skill store', () => {
  it('writes private account roots atomically and keeps accounts isolated', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-account-skills-'))
    const ctx = new Context()
    await ctx.plugin(LocalAccountSkillStore, { dshHome }).await()
    const input = { name: 'meeting-notes', description: 'Line one\nline two', instructions: 'Summarize decisions.' }
    const first = await ctx.accountSkillStore.install(SessionOwnerId('user-a'), input)
    const repeated = await ctx.accountSkillStore.install(SessionOwnerId('user-a'), input)
    const other = await ctx.accountSkillStore.install(SessionOwnerId('user-b'), { ...input, instructions: 'Private B instructions.' })
    expect(first.changed).toBe(true)
    expect(repeated.changed).toBe(false)
    expect(other.path).not.toBe(first.path)
    expect(first.path).not.toContain('user-a')
    expect(first.path).toContain(createHash('sha256').update('user-a').digest('hex'))
    expect(await readFile(first.path, 'utf8')).toContain('description: "Line one\\nline two"')
    expect((await lstat(first.path)).mode & 0o777).toBe(0o600)
    await expect(ctx.accountSkillStore.install(SessionOwnerId('user-a'), { ...input, instructions: 'Changed.' }))
      .rejects.toBeInstanceOf(SkillInstallConflict)
    await ctx.fiber.dispose()
  })

  it('refuses a symlink in the target skill slot', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-account-skills-link-'))
    const owner = SessionOwnerId('user-link')
    const root = join(dshHome, 'accounts', createHash('sha256').update(owner).digest('hex'), 'skills')
    const outside = await mkdtemp(join(tmpdir(), 'dsh-account-skills-outside-'))
    await mkdir(root, { recursive: true })
    await symlink(outside, join(root, 'linked-skill'))
    const ctx = new Context()
    await ctx.plugin(LocalAccountSkillStore, { dshHome }).await()
    await expect(ctx.accountSkillStore.install(owner, {
      name: 'linked-skill', description: 'Unsafe', instructions: 'Do not write.',
    })).rejects.toThrow('unsafe skill path')
    await ctx.fiber.dispose()
  })
})
