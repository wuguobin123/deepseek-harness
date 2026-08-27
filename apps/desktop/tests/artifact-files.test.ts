import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const electron = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  openPath: vi.fn(async (_filePath: string) => ''),
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog: electron.showSaveDialog },
  shell: { openPath: electron.openPath },
}))

import { ArtifactFileActions } from '../src/main/artifact-files'

const ARTIFACT_ID = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function artifactValue(mediaType: 'text/html' | 'application/pdf', content: string | Buffer = '<h1>报告</h1>') {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  return {
    view: {
      artifactId: ARTIFACT_ID,
      kind: mediaType === 'text/html' ? 'html' as const : 'doc' as const,
      mediaType,
      bytes: bytes.byteLength,
      title: '季度:报告',
    },
    bytesBase64: bytes.toString('base64'),
  }
}

describe('native artifact files', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'dsh-artifact-files-test-'))
    electron.showSaveDialog.mockReset()
    electron.openPath.mockReset().mockResolvedValue('')
  })

  afterEach(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('saves the authorized original bytes to the selected regular path', async () => {
    const target = path.join(root, 'saved.html')
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    const files = new ArtifactFileActions({
      readArtifact: async () => artifactValue('text/html'),
      downloadsDirectory: root,
      temporaryDirectory: root,
    })

    await expect(files.save(ARTIFACT_ID)).resolves.toEqual({ status: 'saved' })
    await expect(readFile(target, 'utf8')).resolves.toBe('<h1>报告</h1>')
    expect(electron.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: path.join(root, '季度-报告.html'),
    }))
  })

  it('opens a private no-network HTML copy and removes it on dispose', async () => {
    const files = new ArtifactFileActions({
      readArtifact: async () => artifactValue('text/html', '<script>window.ready = true</script>'),
      downloadsDirectory: root,
      temporaryDirectory: root,
    })

    await expect(files.openHtmlInBrowser(ARTIFACT_ID)).resolves.toEqual({ opened: true })
    const openedPath = electron.openPath.mock.calls[0]?.[0]
    expect(openedPath).toMatch(/xiaowei-artifact-/)
    expect(await readFile(openedPath, 'utf8')).toContain("connect-src 'none'")
    if (process.platform !== 'win32') {
      expect((await stat(path.dirname(openedPath))).mode & 0o777).toBe(0o700)
      expect((await stat(openedPath)).mode & 0o777).toBe(0o600)
    }

    await files.dispose()
    await expect(stat(openedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects non-HTML browser opens and mismatched read results', async () => {
    const pdfFiles = new ArtifactFileActions({
      readArtifact: async () => artifactValue('application/pdf', Buffer.from('%PDF')),
      downloadsDirectory: root,
      temporaryDirectory: root,
    })
    await expect(pdfFiles.openHtmlInBrowser(ARTIFACT_ID)).rejects.toThrow('仅 HTML')
    expect(electron.openPath).not.toHaveBeenCalled()

    const wrongFiles = new ArtifactFileActions({
      readArtifact: async () => ({
        ...artifactValue('text/html'),
        view: { ...artifactValue('text/html').view, artifactId: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      }),
      downloadsDirectory: root,
      temporaryDirectory: root,
    })
    await expect(wrongFiles.save(ARTIFACT_ID)).rejects.toThrow('不匹配')
  })
})
