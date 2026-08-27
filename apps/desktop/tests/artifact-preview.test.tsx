// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifact } from '../src/renderer/api'
import {
  DocumentPreview,
  htmlPreviewGeometry,
  markdownImageSource,
  withArtifactCsp,
} from '../src/renderer/features/document-preview/DocumentPreview'
import { DocumentPreviewPanel } from '../src/renderer/features/document-preview/DocumentPreviewPanel'
import { HtmlPreviewRow } from '../src/renderer/features/html-preview/HtmlPreviewRow'
import { apply as applyDocPreviewToolview } from '../src/renderer/features/doc-preview/doc-preview-toolview'
import { createArtifactPreviewHandler } from '../src/main/artifact-preview-protocol'

const ARTIFACT_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ARTIFACT_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

function view(artifactId: string, mediaType: 'text/html' | 'text/markdown', title: string) {
  return {
    artifactId,
    kind: 'doc' as const,
    source: 'tool-doc' as const,
    mediaType,
    bytes: 24,
    title,
    sessionId: 'session-a',
    createdAt: '2026-08-25T00:00:00.000Z',
  }
}

describe('artifact preview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
  })

  it('injects a no-network policy into sandboxed HTML', async () => {
    vi.spyOn(artifact, 'read').mockResolvedValue({
      view: view(ARTIFACT_A, 'text/html', '页面'),
      bytesBase64: encoded('<html><head><title>x</title></head><body>ok</body></html>'),
    })

    await act(async () => { root.render(<DocumentPreview artifactId={ARTIFACT_A} />) })
    const frame = container.querySelector('iframe')

    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toContain("connect-src 'none'")
    expect(frame?.getAttribute('srcdoc')).toContain('img-src data: blob:')
  })

  it('uses the authenticated artifact protocol in packaged renderer', async () => {
    vi.spyOn(artifact, 'read').mockResolvedValue({
      view: view(ARTIFACT_A, 'text/html', '页面'),
      bytesBase64: encoded('<script>window.ready = true</script>'),
    })
    const originalProtocol = window.location.protocol
    Object.defineProperty(window, 'location', { configurable: true, value: { protocol: 'file:' } })
    try {
      container.remove()
      await act(async () => { root.render(<DocumentPreview artifactId={ARTIFACT_A} />) })
      const frame = container.querySelector('iframe')
      expect(frame?.getAttribute('src')).toBe(`xiaowei-artifact://preview/${encodeURIComponent(ARTIFACT_A)}`)
      expect(frame?.getAttribute('srcdoc')).toBeNull()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: { protocol: originalProtocol } })
    }
  })

  it('re-reads only HTML artifacts and returns non-cacheable CSP responses', async () => {
    const readArtifact = vi.fn().mockResolvedValue({
      view: { artifactId: ARTIFACT_A, kind: 'doc', mediaType: 'text/html', bytes: 36 },
      bytesBase64: encoded('<script>window.ready = true</script>'),
    })
    const handler = createArtifactPreviewHandler(readArtifact)
    const result = await handler(new Request(`xiaowei-artifact://preview/${encodeURIComponent(ARTIFACT_A)}`))
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('content-security-policy')).toContain("script-src 'unsafe-inline'")
    expect(await result.text()).toContain('Content-Security-Policy')
    expect(readArtifact).toHaveBeenCalledWith(ARTIFACT_A)
  })

  it('rejects non-HTML and malformed protocol requests', async () => {
    const handler = createArtifactPreviewHandler(async () => ({
      view: { artifactId: ARTIFACT_A, kind: 'doc', mediaType: 'text/markdown', bytes: 1 },
      bytesBase64: 'YQ==',
    }))
    expect((await handler(new Request(`xiaowei-artifact://preview/${encodeURIComponent(ARTIFACT_A)}?x=1`))).status).toBe(404)
    expect((await handler(new Request(`xiaowei-artifact://preview/${encodeURIComponent(ARTIFACT_A)}`))).status).toBe(415)
  })

  it('fits a desktop HTML viewport into a narrow canvas without scaling a wide canvas', () => {
    const narrow = htmlPreviewGeometry(340, 500)
    expect(narrow.viewportWidth).toBe(960)
    expect(narrow.viewportHeight).toBeCloseTo(1411.76, 2)
    expect(narrow.scale).toBeCloseTo(340 / 960, 5)

    expect(htmlPreviewGeometry(1280, 720)).toEqual({
      viewportWidth: 1280,
      viewportHeight: 720,
      scale: 1,
    })
  })

  it('renders Markdown semantics without remote media or navigation', async () => {
    vi.spyOn(artifact, 'read').mockResolvedValue({
      view: view(ARTIFACT_A, 'text/markdown', '说明'),
      bytesBase64: encoded('# 标题\n\n![远程图](https://example.com/a.png)\n\n[外部链接](https://example.com)'),
    })

    await act(async () => { root.render(<DocumentPreview artifactId={ARTIFACT_A} />) })

    expect(container.querySelector('h1')?.textContent).toBe('标题')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[远程图]')
    expect(container.textContent).toContain('外部链接')
    expect(markdownImageSource('https://example.com/a.png')).toBeUndefined()
    expect(markdownImageSource('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==')
  })

  it('lists only the active session and selects the requested artifact', async () => {
    const list = vi.spyOn(artifact, 'list').mockResolvedValue({
      items: [
        view(ARTIFACT_A, 'text/html', '第一份'),
        { ...view(ARTIFACT_B, 'text/markdown', '第二份'), createdAt: '2026-08-25T01:00:00.000Z' },
      ],
    })
    const read = vi.spyOn(artifact, 'read').mockResolvedValue({
      view: view(ARTIFACT_A, 'text/html', '第一份'),
      bytesBase64: encoded('<p>first</p>'),
    })

    await act(async () => {
      root.render(<DocumentPreviewPanel sessionId="session-a" initialArtifactId={ARTIFACT_A} />)
    })

    expect(list).toHaveBeenCalledWith({ workspaceId: undefined, sessionId: 'session-a', kind: undefined })
    expect(container.querySelectorAll('[data-testid="document-preview-panel-item"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="document-preview-panel-count"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="document-preview-panel"] h2')).toBeNull()
    expect(container.querySelector('.document-preview-panel__summary-copy strong')?.textContent).toBe('第一份')
    expect(container.querySelector(`[data-artifact-id="${ARTIFACT_A}"]`)?.parentElement?.classList.contains('is-active')).toBe(true)
    expect(container.querySelector(`[data-artifact-id="${ARTIFACT_A}"]`)?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector(`[data-artifact-id="${ARTIFACT_B}"]`)?.hasAttribute('aria-current')).toBe(false)
    expect(read).toHaveBeenCalledWith({ artifactId: ARTIFACT_A })
  })

  it('supports full-screen preview, download, and HTML browser handoff', async () => {
    vi.spyOn(artifact, 'list').mockResolvedValue({
      items: [view(ARTIFACT_A, 'text/html', '网站')],
    })
    vi.spyOn(artifact, 'read').mockResolvedValue({
      view: view(ARTIFACT_A, 'text/html', '网站'),
      bytesBase64: encoded('<p>site</p>'),
    })
    const save = vi.spyOn(artifact, 'save').mockResolvedValue({ status: 'saved' })
    const openInBrowser = vi.spyOn(artifact, 'openInBrowser').mockResolvedValue({ opened: true })

    await act(async () => {
      root.render(<DocumentPreviewPanel sessionId="session-a" initialArtifactId={ARTIFACT_A} />)
    })
    expect(container.querySelector('[data-testid="document-preview-panel-open-browser"]')?.getAttribute('aria-label')).toBe('使用默认浏览器打开')
    expect(container.querySelector('[data-testid="document-preview-panel-fullscreen"]')?.getAttribute('aria-label')).toBe('全屏预览')
    expect(container.querySelector('[data-testid="document-preview-panel-download"]')?.getAttribute('aria-label')).toBe('下载原始产物')
    expect(container.querySelector('[data-testid="document-preview-panel-refresh"]')?.getAttribute('aria-label')).toBe('刷新产物列表')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="document-preview-panel-fullscreen"]')?.click()
    })
    expect(document.body.querySelector('[data-testid="document-preview-panel"]')?.getAttribute('data-fullscreen')).toBe('true')
    expect(document.body.querySelector('[data-testid="document-preview-panel-fullscreen"]')?.getAttribute('aria-label')).toBe('退出全屏预览')

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="document-preview-panel-open-browser"]')?.click()
    })
    expect(openInBrowser).toHaveBeenCalledWith({ artifactId: ARTIFACT_A })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="document-preview-panel-download"]')?.click()
    })
    expect(save).toHaveBeenCalledWith({ artifactId: ARTIFACT_A })
    expect(document.body.textContent).toContain('已保存到本地')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="document-preview-panel"]')?.hasAttribute('data-fullscreen')).toBe(false)
  })

  it('opens the details surface from a compact artifact card', async () => {
    const openArtifact = vi.fn()
    const block = {
      resultView: {
        card: 'html',
        title: '季度页面',
        artifactId: ARTIFACT_A,
        bytes: 2048,
        mediaType: 'text/html',
      },
    }

    await act(async () => {
      root.render(<HtmlPreviewRow
        callId="call-a"
        toolName="html_build"
        block={block as never}
        openFile={() => {}}
        openArtifact={openArtifact}
      />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="html-preview-row"]')?.click()
    })

    expect(openArtifact).toHaveBeenCalledWith(ARTIFACT_A)
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('places the policy before artifact content without an explicit head', () => {
    const secured = withArtifactCsp('<script>window.ready = true</script>')
    expect(secured.indexOf('Content-Security-Policy')).toBeLessThan(secured.indexOf('<script>'))
  })

  it('registers the analysis tool with the sheet artifact preview', () => {
    const keys: string[] = []
    const slots = {
      inject(_slot: string, factory: () => Iterable<unknown>) {
        for (const _disposer of factory()) void _disposer
      },
      register(options: { key: string }) {
        keys.push(options.key)
        return () => {}
      },
    }

    applyDocPreviewToolview({ slots } as never)

    expect(keys).toEqual(['doc_build', 'sheet_build', 'sheet_analyze'])
  })
})
