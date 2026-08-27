/** Bounded, link-free serialization of one user-selected local directory. */
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

/** Client-side limits mirrored by the authenticated server import endpoint. */
export const LOCAL_IMPORT_LIMITS = { maxFiles: 200, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024 } as const

/**
 * Read a local directory into bounded relative base64 file entries.
 * Symbolic links, special files, concurrent identity changes, and limit
 * overruns fail before any request is sent.
 * @param root - absolute directory selected through the native picker.
 * @returns the display title and file entries for workspace.importDirectory.
 */
export async function readLocalDirectory(root: string): Promise<{ title: string; files: Array<{ path: string; content: string }> }> {
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('请选择一个普通本机目录')
  const files: Array<{ path: string; content: string }> = []
  let total = 0
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink() || entry.isSymbolicLink()) throw new Error(`不能导入符号链接：${entry.name}`)
      if (info.isDirectory()) await walk(full)
      else if (info.isFile()) {
        if (files.length >= LOCAL_IMPORT_LIMITS.maxFiles) throw new Error(`目录最多可导入 ${LOCAL_IMPORT_LIMITS.maxFiles} 个文件`)
        if (info.size > LOCAL_IMPORT_LIMITS.maxFileBytes) throw new Error(`单个文件不能超过 ${LOCAL_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MiB`)
        const path = relative(root, full).split(sep).join('/')
        if (path.split('/').includes('..')) throw new Error('目录包含无效的父级路径')
        const data = await readFile(full)
        const after = await lstat(full)
        if (!after.isFile() || after.isSymbolicLink() || after.dev !== info.dev || after.ino !== info.ino) {
          throw new Error(`读取时文件发生变化：${path}`)
        }
        if (data.byteLength > LOCAL_IMPORT_LIMITS.maxFileBytes || total + data.byteLength > LOCAL_IMPORT_LIMITS.maxTotalBytes) {
          throw new Error(`目录总大小不能超过 ${LOCAL_IMPORT_LIMITS.maxTotalBytes / 1024 / 1024} MiB`)
        }
        files.push({ path, content: data.toString('base64') })
        total += data.byteLength
      } else throw new Error(`不能导入特殊文件：${entry.name}`)
    }
  }
  await walk(root)
  return { title: basename(root) || root, files }
}
