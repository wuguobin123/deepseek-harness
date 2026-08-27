/** Approval-protected installer for Skills stored in the local Harness home. */
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isSkillName } from '@deepseek-ai/dsh-skill'

export const name = 'tool-skill-install-local'
export const inject = ['tools', 'skills']
/** Maximum encoded size of one generated `SKILL.md`. */
export const MAX_SKILL_BYTES = 256 * 1024

/** Local Skill installer configuration. */
export interface Config {
  /** Harness home containing the private `skills` directory. */
  dshHome: string
}

/** Local Skill installer configuration schema. */
export const Config: z<Config> = z.object({ dshHome: z.string().required() })

/** Content needed to publish one local Skill. */
export interface SkillInstallInput {
  /** Kebab-case directory and Skill name. */
  name: string
  /** Short discovery description stored in frontmatter. */
  description: string
  /** Markdown instruction body. */
  instructions: string
}

/**
 * Write one local Skill with directory and symlink checks and an atomic rename.
 * @param dshHome - Harness home that owns the private `skills` directory.
 * @param input - Validated Skill identity and Markdown content.
 * @returns the installed Skill name and whether this call created it.
 */
export async function installLocalSkill(
  dshHome: string,
  input: SkillInstallInput,
): Promise<{ name: string; changed: boolean }> {
  if (!isSkillName(input.name)) throw new Error('invalid skill name')
  if (input.description.trim() === '') throw new Error('description is required')
  if (input.instructions.trim() === '') throw new Error('instructions are required')
  const content = `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description.trim())}\n---\n\n${input.instructions}\n`
  if (Buffer.byteLength(content) > MAX_SKILL_BYTES) throw new Error(`skill exceeds ${MAX_SKILL_BYTES} bytes`)
  const home = resolve(dshHome)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const homeInfo = await lstat(home)
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink()) throw new Error(`unsafe skill path: ${home}`)
  const root = await secureMkdir(await realpath(home), ['skills'])
  const dir = join(root, input.name)
  const target = join(dir, 'SKILL.md')
  try {
    const info = await lstat(dir)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`unsafe skill path: ${dir}`)
    const existing = await safeRead(target)
    if (existing === content) return { name: input.name, changed: false }
    if (existing !== undefined) throw new Error(`skill "${input.name}" already exists with different content`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staging = await mkdtemp(join(root, `.staging-${process.pid}-`))
  try {
    await chmod(staging, 0o700)
    const staged = join(staging, 'SKILL.md')
    await writeFile(staged, content, { mode: 0o600, flag: 'wx' })
    const handle = await open(staged, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(staging, dir)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const raced = await safeRead(target)
      if (raced === undefined) throw new Error(`skill "${input.name}" already exists with different content`)
      if (raced !== content) throw new Error(`skill "${input.name}" already exists with different content`)
      return { name: input.name, changed: false }
    }
    return { name: input.name, changed: true }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Register the local `skill_install` model tool. */
export function apply(ctx: Context, config: Config): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'skill_install') return await next()
    if (exec.agent?.session.header.origin === 'subagent') {
      return { kind: 'deny', reason: 'a subagent cannot install local skills' }
    }
    return { kind: 'ask', reason: 'Install the proposed Skill in this computer\'s private Skill directory.' }
  })
  const tool = defineTool({
    name: 'skill_install',
    description: 'Install a private skill on this computer.',
    parameters: {
      name: { type: 'string', required: true, description: 'Kebab-case skill name.' },
      description: { type: 'string', required: true, description: 'Short skill description.' },
      instructions: { type: 'string', required: true, description: 'Markdown instructions.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.changed ? 'Installed' : 'Already installed'} skill ${value.name}`,
      }],
    },
    async execute(args: SkillInstallInput, exec) {
      if (exec.agent?.session.header.origin === 'subagent') throw new Error('a subagent cannot install local skills')
      const result = await installLocalSkill(config.dshHome, args)
      if (result.changed) ctx.skills.refresh()
      return result
    },
    presentCall: args => ({
      card: 'generic',
      title: `Install skill ${args.name}`,
      kind: 'edit',
      rawInput: args.name,
    }),
  })
  ctx.effect(() => ctx.tools.register(tool))
}

async function secureMkdir(base: string, parts: readonly string[]): Promise<string> {
  let current = base
  for (const part of parts) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe skill path: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe skill path: ${current}`)
    }
  }
  return current
}

async function safeRead(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`unsafe skill path: ${path}`)
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
