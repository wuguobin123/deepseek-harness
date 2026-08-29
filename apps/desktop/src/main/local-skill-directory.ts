/** Private, link-free storage for user-installed local Skills. */
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parseDocument } from 'yaml'

const MAX_FILES = 500
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Browser-safe summary of one directory under the local Skill store. */
export interface InstalledSkillRecord {
  readonly directoryName: string
  readonly name?: string
  readonly description?: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly valid: boolean
  readonly error?: string
}

/** Result of publishing a local Skill directory. */
export interface SkillDirectoryInstallResult {
  readonly status: 'installed' | 'unchanged'
  readonly skill: InstalledSkillRecord
}

interface FileEntry { relativePath: string; bytes: Buffer; executable: boolean }

/** Manages Skills at `<dshHome>/skills` without exposing filesystem paths. */
export class LocalSkillDirectoryManager {
  private readonly home: string
  private readonly skillsRoot: string

  /**
   * Create a manager for one fixed local runtime home.
   *
   * @param dshHome - Formal local runtime home derived by the Electron main process.
   */
  constructor({ dshHome }: { dshHome: string }) {
    this.home = resolve(dshHome)
    this.skillsRoot = join(this.home, 'skills')
  }

  /**
   * List valid and invalid Skill directories, omitting all filesystem paths.
   *
   * @returns Browser-safe installed bundle records.
   */
  async list(): Promise<InstalledSkillRecord[]> {
    try { await this.ensureSkillsRoot() } catch (error) { if (isCode(error, 'ENOENT')) return []; throw error }
    const entries = await readdir(this.skillsRoot, { withFileTypes: true })
    const records: InstalledSkillRecord[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.staging-') || entry.name.startsWith('.install-')) continue
      const directory = join(this.skillsRoot, entry.name)
      let info: Stats
      try { info = await lstat(directory) } catch (error) { records.push(invalid(entry.name, error)); continue }
      if (info.isSymbolicLink() || !info.isDirectory()) { records.push(invalid(entry.name, new Error('not a directory'))); continue }
      let files: FileEntry[] = []
      try {
        files = await collectFiles(directory)
        const rootFile = files.find(file => file.relativePath === 'SKILL.md')
        if (!rootFile) throw new Error('Skill directory must contain SKILL.md')
        const parsed = parseFrontmatter(rootFile.bytes.toString('utf8'))
        records.push(record(entry.name, parsed, files))
      } catch (error) { records.push(invalid(entry.name, error, files, [this.home])) }
    }
    return records
  }

  /**
   * Validate and atomically install a complete local Skill directory.
   *
   * @param sourceDirectory - Directory selected by the native main-process picker.
   * @returns The installed or unchanged browser-safe record.
   */
  async install(sourceDirectory: string): Promise<SkillDirectoryInstallResult> {
    const source = resolve(sourceDirectory)
    try {
      const sourceInfo = await lstat(source)
      if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) throw new Error('Skill source must be a directory')
      const files = await collectFiles(source)
      const rootFile = files.find(file => file.relativePath === 'SKILL.md')
      if (!rootFile) throw new Error('Skill source must contain SKILL.md')
      const metadata = parseFrontmatter(rootFile.bytes.toString('utf8'))
      const digest = treeDigest(files)
      await this.ensureSkillsRoot()
      const target = join(this.skillsRoot, metadata.name)
      const lock = join(this.skillsRoot, `.install-${metadata.name}`)
      try {
        await mkdir(lock, { mode: 0o700 })
      } catch (error) {
        if (isCode(error, 'EEXIST')) throw new Error(`Skill "${metadata.name}" installation is already in progress`)
        throw error
      }
      try {
        const existing = await readTree(target)
        if (existing) {
          if (existing.digest === digest) return { status: 'unchanged', skill: record(metadata.name, metadata, files) }
          throw new Error(`Skill "${metadata.name}" already exists with different content`)
        }
        const staging = await mkdtemp(join(this.skillsRoot, `.staging-${process.pid}-`))
        try {
          await chmod(staging, 0o700)
          for (const file of files) {
            const destination = join(staging, ...file.relativePath.split('/'))
            const parent = join(destination, '..')
            await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700)
            await writeFile(destination, file.bytes, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 })
            await chmod(destination, file.executable ? 0o700 : 0o600)
            await syncFile(destination)
          }
          const staged = await readTree(staging)
          if (!staged || staged.digest !== digest) throw new Error('staged Skill digest mismatch')
          await rename(staging, target)
          return { status: 'installed', skill: record(metadata.name, metadata, files) }
        } finally { await rm(staging, { recursive: true, force: true }) }
      } finally {
        await rm(lock, { recursive: true, force: true })
      }
    } catch (error) {
      throw new Error(safeError(error, [sourceDirectory, source, this.home]))
    }
  }

  private async ensureSkillsRoot(): Promise<void> {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    const homeInfo = await lstat(this.home)
    if (homeInfo.isSymbolicLink() || !homeInfo.isDirectory()) throw new Error('unsafe dshHome')
    await mkdir(this.skillsRoot, { recursive: true, mode: 0o700 })
    const info = await lstat(this.skillsRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('unsafe skills directory')
    await chmod(this.home, 0o700); await chmod(this.skillsRoot, 0o700)
  }
}

async function collectFiles(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = []; let total = 0
  async function walk(directory: string): Promise<void> {
    const before = await lstat(directory)
    if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('source tree changed during install')
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === '.git') continue
      const full = join(directory, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink() || entry.isSymbolicLink()) throw new Error(`source contains a link: ${entry.name}`)
      if (info.isDirectory()) await walk(full)
      else if (info.isFile()) {
        if (files.length >= MAX_FILES) throw new Error(`Skill exceeds ${MAX_FILES} files`)
        if (info.size > MAX_FILE_BYTES) throw new Error(`Skill file exceeds ${MAX_FILE_BYTES} bytes`)
        const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW)
        let bytes: Buffer
        try {
          const opened = await handle.stat()
          if (!sameFile(info, opened)) throw new Error('source tree changed during install')
          bytes = await handle.readFile()
          const after = await handle.stat()
          if (!sameFile(opened, after) || bytes.byteLength > MAX_FILE_BYTES) throw new Error('source tree changed during install')
        } finally {
          await handle.close()
        }
        total += bytes.byteLength; if (total > MAX_TOTAL_BYTES) throw new Error(`Skill exceeds ${MAX_TOTAL_BYTES} bytes`)
        files.push({ relativePath: relative(root, full).split(sep).join('/'), bytes, executable: (info.mode & 0o111) !== 0 })
      } else throw new Error(`source contains a special file: ${entry.name}`)
    }
    const after = await lstat(directory); if (!sameFile(before, after)) throw new Error('source tree changed during install')
  }
  await walk(root); return files
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0] !== '---') throw new Error('SKILL.md requires YAML frontmatter')
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
  if (end < 0) throw new Error('unterminated YAML frontmatter')
  const document = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`invalid YAML frontmatter: ${document.errors[0]?.message ?? 'parse failed'}`)
  const data: unknown = document.toJS({ maxAliasCount: 50 })
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('YAML frontmatter must be an object')
  const { name, description } = data as Record<string, unknown>
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new Error('invalid skill name')
  if (typeof description !== 'string' || !description.trim()) throw new Error('description is required')
  return { name, description }
}

function treeDigest(files: FileEntry[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath).update('\0')
      .update(file.executable ? 'x' : '-').update('\0')
      .update(file.bytes).update('\0')
  }
  return hash.digest('hex')
}

async function readTree(directory: string): Promise<{ digest: string } | undefined> {
  try {
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('unsafe target')
    const files = await collectFiles(directory)
    return { digest: treeDigest(files) }
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined
    throw error
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function sameFile(a: Stats, b: Stats): boolean {
  return b.isFile() === a.isFile()
    && b.isDirectory() === a.isDirectory()
    && !b.isSymbolicLink()
    && a.dev === b.dev
    && a.ino === b.ino
    && a.size === b.size
    && a.mtimeMs === b.mtimeMs
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
}

function record(
  directoryName: string,
  metadata: { name: string; description: string },
  files: FileEntry[],
): InstalledSkillRecord {
  return {
    directoryName,
    name: metadata.name,
    description: metadata.description,
    valid: true,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
  }
}

function invalid(
  name: string,
  error: unknown,
  files: FileEntry[] = [],
  privateRoots: string[] = [],
): InstalledSkillRecord {
  return {
    directoryName: name,
    valid: false,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
    error: safeError(error, privateRoots),
  }
}

function safeError(error: unknown, privateRoots: string[]): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const root of privateRoots.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(root).join('<private>')
  }
  return message
}
