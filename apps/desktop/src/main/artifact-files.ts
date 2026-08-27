/** Native save and external-browser actions for authenticated artifacts. */
import { dialog, shell } from 'electron'
import { chmod, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { withArtifactCsp } from '../shared/artifact-html'

const ArtifactReadValueSchema = z.object({
  view: z.object({
    artifactId: z.string().min(1),
    kind: z.enum(['html', 'slides', 'doc', 'sheet', 'chart']),
    mediaType: z.enum([
      'text/html',
      'text/markdown',
      'image/svg+xml',
      'image/png',
      'image/jpeg',
      'application/pdf',
    ]),
    bytes: z.number().int().nonnegative(),
    title: z.string().optional(),
    name: z.string().optional(),
  }),
  bytesBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})

type ArtifactReadValue = z.infer<typeof ArtifactReadValueSchema>

const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<ArtifactReadValue['view']['mediaType'], string>> = {
  'text/html': '.html',
  'text/markdown': '.md',
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/pdf': '.pdf',
}

const EXTERNAL_PREVIEW_LIFETIME_MS = 30 * 60 * 1000

export interface ArtifactFileActionsDeps {
  /** Re-authorize and read the artifact through the main-process API client. */
  readArtifact: (artifactId: string) => Promise<unknown>
  downloadsDirectory: string
  temporaryDirectory: string
}

export type SaveArtifactResult = { status: 'saved' } | { status: 'cancelled' }

function safeArtifactName(view: ArtifactReadValue['view']): string {
  const extension = EXTENSION_BY_MEDIA_TYPE[view.mediaType]
  const fallback = `${view.kind}-artifact${extension}`
  const source = path.basename(view.name ?? view.title ?? fallback)
  const printable = Array.from(source).map(character => character.charCodeAt(0) < 32 ? '-' : character).join('')
  const safe = printable
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  const base = safe.length > 0 ? safe : fallback
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

/** Validate an artifact.read response and decode its exact requested bytes. */
export function decodeArtifact(value: unknown, requestedId: string): { view: ArtifactReadValue['view']; bytes: Buffer } {
  const parsed = ArtifactReadValueSchema.parse(value)
  if (parsed.view.artifactId !== requestedId) {
    throw new Error('产物读取结果与请求不匹配')
  }
  const bytes = Buffer.from(parsed.bytesBase64, 'base64')
  if (bytes.byteLength !== parsed.view.bytes) {
    throw new Error('产物字节长度校验失败')
  }
  return { view: parsed.view, bytes }
}

/** Owns native artifact files and removes temporary browser previews. */
export class ArtifactFileActions {
  readonly #deps: ArtifactFileActionsDeps
  readonly #temporaryRoots = new Set<string>()
  readonly #cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(deps: ArtifactFileActionsDeps) {
    this.#deps = deps
  }

  /** Save the original artifact bytes to a person-selected local path. */
  async save(artifactId: string): Promise<SaveArtifactResult> {
    const { view, bytes } = decodeArtifact(await this.#deps.readArtifact(artifactId), artifactId)
    const result = await dialog.showSaveDialog({
      title: '下载产物',
      defaultPath: path.join(this.#deps.downloadsDirectory, safeArtifactName(view)),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || result.filePath === '') return { status: 'cancelled' }
    try {
      const existing = await lstat(result.filePath)
      if (existing.isSymbolicLink() || existing.isDirectory()) {
        throw new Error('所选保存位置不是普通文件')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeFile(result.filePath, bytes, { mode: 0o600 })
    return { status: 'saved' }
  }

  /** Open one self-contained HTML artifact in the operating system browser. */
  async openHtmlInBrowser(artifactId: string): Promise<{ opened: true }> {
    const { view, bytes } = decodeArtifact(await this.#deps.readArtifact(artifactId), artifactId)
    if (view.mediaType !== 'text/html') throw new Error('仅 HTML 产物支持浏览器预览')

    const root = await mkdtemp(path.join(this.#deps.temporaryDirectory, 'xiaowei-artifact-'))
    await chmod(root, 0o700)
    this.#temporaryRoots.add(root)
    const filePath = path.join(root, safeArtifactName(view))
    await writeFile(filePath, withArtifactCsp(bytes.toString('utf8')), { flag: 'wx', mode: 0o600 })

    const openError = await shell.openPath(filePath)
    if (openError !== '') {
      await this.#removeTemporaryRoot(root)
      throw new Error(openError)
    }
    const timer = setTimeout(() => { void this.#removeTemporaryRoot(root) }, EXTERNAL_PREVIEW_LIFETIME_MS)
    timer.unref()
    this.#cleanupTimers.set(root, timer)
    return { opened: true }
  }

  /** Remove every temporary preview before the desktop process exits. */
  async dispose(): Promise<void> {
    await Promise.all([...this.#temporaryRoots].map(root => this.#removeTemporaryRoot(root)))
  }

  async #removeTemporaryRoot(root: string): Promise<void> {
    const timer = this.#cleanupTimers.get(root)
    if (timer !== undefined) clearTimeout(timer)
    this.#cleanupTimers.delete(root)
    this.#temporaryRoots.delete(root)
    await rm(root, { force: true, recursive: true })
  }
}
