/** Secure account-private SKILL.md storage. */
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SessionOwnerId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'account-skill-store'
/** Required service dependencies. */
export const inject = ['skills']
/** Maximum encoded `SKILL.md` size accepted by the store. */
export const MAX_SKILL_BYTES = 256 * 1024

/** Account Skill store configuration. */
export interface Config {
  /** Root directory containing account-owned skill data. */
  dshHome: string
}
/** Runtime validation for account Skill store configuration. */
export const Config: z<Config> = z.object({ dshHome: z.string().required() })
/** Validated content supplied by a trusted installation consumer. */
export interface SkillInstallInput { name: string; description: string; instructions: string }
/** Publication result; the path remains inside the server boundary. */
export interface SkillInstallResult { name: string; path: string; changed: boolean }

/** Raised when an existing Skill has different content. */
export class SkillInstallConflict extends Error {
  /** Stable machine-readable conflict code. */
  readonly code = 'SKILL_CONFLICT'
}

declare module '@deepseek-ai/cordis' { interface Context { accountSkillStore: AccountSkillStore } }

/** Service for account-owned skill files. */
export abstract class AccountSkillStore extends Service {
  constructor(ctx: Context) { super(ctx, 'accountSkillStore') }
  /**
   * Publish one account-owned Skill.
   * @param ownerId - durable Session owner.
   * @param input - validated Skill content.
   * @returns publication result.
   */
  abstract install(ownerId: SessionOwnerId, input: SkillInstallInput): Promise<SkillInstallResult>
}

/** Local implementation; owner ids are hashed before entering the filesystem. */
export class LocalAccountSkillStore extends AccountSkillStore {
  static Config = Config
  /** Bind the service to its account storage root. */
  constructor(ctx: Context, readonly config: Config) { super(ctx) }
  override async install(ownerId: SessionOwnerId, input: SkillInstallInput): Promise<SkillInstallResult> {
    if (ownerId.length === 0) throw new Error('ownerId is required')
    if (!isSkillName(input.name)) throw new Error('invalid skill name')
    if (input.description.trim().length === 0) throw new Error('description is required')
    if (input.description.length > 1_024) throw new Error('description exceeds 1024 characters')
    if (input.instructions.trim().length === 0) throw new Error('instructions are required')
    const content = `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description.trim())}\n---\n\n${input.instructions}\n`
    const bytes = Buffer.byteLength(content)
    if (bytes > MAX_SKILL_BYTES) throw new Error(`skill exceeds ${MAX_SKILL_BYTES} bytes`)
    const configuredHome = resolve(this.config.dshHome)
    await mkdir(configuredHome, { recursive: true, mode: 0o700 })
    const homeInfo = await lstat(configuredHome)
    if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink()) throw new Error(`unsafe skill path: ${configuredHome}`)
    const physicalHome = await realpath(configuredHome)
    const root = await secureMkdir(physicalHome, [
      'accounts', createHash('sha256').update(ownerId).digest('hex'), 'skills',
    ])
    const targetDir = join(root, input.name)
    const targetFile = join(targetDir, 'SKILL.md')
    try {
      const targetInfo = await lstat(targetDir)
      if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) throw new Error(`unsafe skill path: ${targetDir}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const existing = await safeRead(targetFile)
    if (existing !== undefined) {
      if (existing === content) return { name: input.name, path: targetFile, changed: false }
      throw new SkillInstallConflict(`skill "${input.name}" already exists with different content`)
    }
    const staging = await mkdtemp(join(root, `.staging-${process.pid}-`))
    try {
      await chmod(staging, 0o700)
      const stagingFile = join(staging, 'SKILL.md')
      await writeFile(stagingFile, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await chmod(stagingFile, 0o600)
      const handle = await open(stagingFile, 'r')
      try { await handle.sync() } finally { await handle.close() }
      try { await rename(staging, targetDir) } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
        const raced = await safeRead(targetFile)
        if (raced !== content) throw new SkillInstallConflict(`skill "${input.name}" already exists with different content`)
        return { name: input.name, path: targetFile, changed: false }
      }
      return { name: input.name, path: targetFile, changed: true }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}

/** Mount the local account Skill store provider. */
export function apply(ctx: Context, config: Config): void { ctx.plugin(LocalAccountSkillStore, config) }
export default LocalAccountSkillStore

async function secureMkdir(base: string, parts: readonly string[]): Promise<string> {
  let current = base
  for (const part of parts) {
    current = join(current, part)
    try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe skill path: ${current}`) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await mkdir(current, { mode: 0o700 }) } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe skill path: ${current}`)
      await chmod(current, 0o700)
    }
  }
  return current
}
async function safeRead(path: string): Promise<string | undefined> {
  try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isFile()) throw new Error(`unsafe skill path: ${path}`); return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
