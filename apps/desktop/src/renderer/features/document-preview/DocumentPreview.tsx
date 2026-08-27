/**
 * DocumentPreview — single-artifact viewer.
 *
 * Renders one artifact produced by `tool-html` / `tool-slides` /
 * `tool-doc` / `tool-sheet` / `tool-chart` (xiaowei's 4+1 blessed
 * products). Routes by `mediaType` + `kind`:
 *
 *   - `text/html` + kind `slides` → isolated iframe (Reveal.js single-file)
 *   - `text/html`               → isolated iframe
 *   - `image/svg+xml`           → inert image data URL (never parent DOM)
 *   - `image/png|jpeg`          → <img src="data:...">
 *   - `application/pdf`         → pdfjs page 1
 *   - `text/markdown`           → semantic Markdown with raw HTML and remote media disabled
 *   - everything else           → fallback to "在系统中打开" + bytes hex
 *
 * The component reads bytes through `api.artifact.read({ artifactId })`
 * exactly once per mount; reloads on `reloadKey` change. Bytes are decoded
 * with `atob` to keep the render path free of `Buffer`.
 *
 * CSS classes match the slots already wired into `styles.css`:
 * `.document-preview__iframe / __image / __pdf / __markdown / __fallback`.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactKind, ArtifactMediaType, ArtifactView } from '../../api'
import { artifact } from '../../api'
import { withArtifactCsp } from '../../../shared/artifact-html'

const ARTIFACT_PREVIEW_SCHEME = 'xiaowei-artifact'

export { withArtifactCsp } from '../../../shared/artifact-html'

export interface DocumentPreviewProps {
  /** The artifact id to render. Workspace scoping happens at the list call. */
  artifactId: string
  /** Optional `kind` override; defaults to the wire-side value. */
  kindHint?: ArtifactKind
  /** Optional `mediaType` override for tool sources that don't tag cleanly. */
  mediaTypeHint?: ArtifactMediaType
  /** Bump to force a re-fetch (e.g. parent wants to invalidate). */
  reloadKey?: string
}

interface Resolved {
  view: ArtifactView
  bytes: Uint8Array
  text: string
}

const HTML_PREVIEW_MIN_WIDTH = 960

/**
 * Resolve the isolated page viewport fitted into one HTML preview canvas.
 * @param canvasWidth - Available preview width in CSS pixels.
 * @param canvasHeight - Available preview height in CSS pixels.
 * @returns Desktop-preserving iframe dimensions and their visual scale.
 */
export function htmlPreviewGeometry(canvasWidth: number, canvasHeight: number): {
  viewportWidth: number
  viewportHeight: number
  scale: number
} {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { viewportWidth: HTML_PREVIEW_MIN_WIDTH, viewportHeight: 1, scale: 1 }
  }
  const viewportWidth = Math.max(HTML_PREVIEW_MIN_WIDTH, canvasWidth)
  const scale = canvasWidth / viewportWidth
  return { viewportWidth, viewportHeight: canvasHeight / scale, scale }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function dataUrl(mediaType: string, bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return `data:${mediaType};base64,${btoa(bin)}`
}

/** Keep Markdown images self-contained so opening a document cannot make a network request. */
export function markdownImageSource(source: string | undefined): string | undefined {
  return source?.startsWith('data:image/') ? source : undefined
}

const markdownComponents = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <span className="document-preview__markdown-link" title={href}>{children}</span>
  ),
  img: ({ alt, src }: { alt?: string; src?: string }) => {
    const safeSource = markdownImageSource(src)
    return safeSource === undefined
      ? <span className="document-preview__markdown-media" aria-label={alt}>[{alt ?? '图片'}]</span>
      : <img src={safeSource} alt={alt ?? ''} />
  },
}

export function DocumentPreview({
  artifactId,
  kindHint,
  mediaTypeHint,
  reloadKey,
}: DocumentPreviewProps): React.JSX.Element {
  const [resolved, setResolved] = React.useState<Resolved | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await artifact.read({ artifactId })
      const bytes = decodeBase64(result.bytesBase64)
      const text = bytesToText(bytes)
      setResolved({ view: result.view, bytes, text })
    } catch (err) {
      setError((err as Error).message)
      setResolved(null)
    } finally {
      setBusy(false)
    }
  }, [artifactId])

  React.useEffect(() => {
    void load()
  }, [load, reloadKey])

  if (busy && resolved === null) {
    return (
      <div className="document-preview document-preview--loading" data-testid="document-preview-loading">
        加载中…
      </div>
    )
  }

  if (error) {
    return (
      <div className="document-preview document-preview--error" data-testid="document-preview-error">
        <p>加载失败：{error}</p>
        <button type="button" onClick={() => void load()}>重试</button>
      </div>
    )
  }

  if (!resolved) return <div className="document-preview" data-testid="document-preview-empty" />

  const kind: ArtifactKind = kindHint ?? resolved.view.kind
  const mediaType: ArtifactMediaType = mediaTypeHint ?? resolved.view.mediaType

  // SVG is deliberately rendered as an image. It never becomes DOM markup in
  // the parent document, so script/event/style injection cannot execute.
  if (mediaType === 'image/svg+xml') {
    return (
      <img
        className="document-preview document-preview__svg"
        data-testid="document-preview-svg"
        data-artifact-id={artifactId}
        data-kind={kind}
        src={dataUrl(mediaType, resolved.bytes)}
        alt={resolved.view.title ?? resolved.view.name ?? artifactId}
      />
    )
  }

  // Image path (PNG / JPEG). Charts produced via tool-chart (raster) hit this.
  if (mediaType === 'image/png' || mediaType === 'image/jpeg') {
    return (
      <img
        className="document-preview document-preview__image"
        data-testid="document-preview-image"
        data-kind={kind}
        data-artifact-id={artifactId}
        src={dataUrl(mediaType, resolved.bytes)}
        alt={resolved.view.title ?? resolved.view.name ?? artifactId}
      />
    )
  }

  // HTML path (text/html). Includes kind='slides' (Reveal.js single-file).
  if (mediaType === 'text/html') {
    return (
      <HtmlPreviewFrame
        artifactId={artifactId}
        kind={kind}
        source={withArtifactCsp(resolved.text)}
        title={resolved.view.title ?? artifactId}
      />
    )
  }

  // ReactMarkdown does not enable `rehype-raw`; HTML in the source is treated
  // as text. Links are inert and remote images become labels, so Markdown
  // preview cannot navigate the shell or fetch third-party media.
  if (mediaType === 'text/markdown') {
    return (
      <article
        className="document-preview document-preview__markdown"
        data-testid="document-preview-markdown"
        data-kind={kind}
        data-artifact-id={artifactId}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{resolved.text}</ReactMarkdown>
      </article>
    )
  }

  // PDF is the only remaining member of the closed ArtifactMediaType union.
  return <PdfPreview bytes={resolved.bytes} title={resolved.view.title ?? artifactId} artifactId={artifactId} kind={kind} />
}

interface HtmlPreviewFrameProps {
  artifactId: string
  kind: ArtifactKind
  source: string
  title: string
}

function HtmlPreviewFrame({ artifactId, kind, source, title }: HtmlPreviewFrameProps): React.JSX.Element {
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = React.useState<ReturnType<typeof htmlPreviewGeometry> | null>(null)

  React.useLayoutEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const update = (): void => {
      const { width, height } = stage.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      const next = htmlPreviewGeometry(width, height)
      setGeometry(current => current !== null
        && current.viewportWidth === next.viewportWidth
        && current.viewportHeight === next.viewportHeight
        && current.scale === next.scale
        ? current
        : next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => { observer.disconnect() }
  }, [])

  return (
    <div
      ref={stageRef}
      className="document-preview document-preview__html-stage"
      data-testid="document-preview-html-stage"
      data-preview-mode={geometry !== null && geometry.scale < 1 ? 'fit' : 'native'}
    >
      <iframe
        className="document-preview__iframe"
        data-testid="document-preview-iframe"
        data-kind={kind}
        data-artifact-id={artifactId}
        // `allow-scripts` is required for Reveal.js / chart runtime JS. The
        // packaged app uses an independently served protocol document so its
        // strict CSP can permit artifact scripts without weakening the parent.
        // Browser development falls back to an opaque srcDoc with the same CSP.
        sandbox="allow-scripts"
        {...(window.location.protocol === 'file:'
          ? { src: `${ARTIFACT_PREVIEW_SCHEME}://preview/${encodeURIComponent(artifactId)}` }
          : { srcDoc: source })}
        style={geometry === null ? undefined : {
          width: geometry.viewportWidth,
          height: geometry.viewportHeight,
          transform: `scale(${geometry.scale})`,
        }}
        title={title}
      />
    </div>
  )
}

interface PdfPreviewProps {
  bytes: Uint8Array
  title: string
  artifactId: string
  kind: ArtifactKind
}

function PdfPreview({ bytes, title, artifactId, kind }: PdfPreviewProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(true)

  React.useEffect(() => {
    const active = { value: true }
    const cleanup: Array<() => void> = []
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
        if (!active.value) return
        const loadingTask = pdfjs.getDocument({ data: bytes })
        const doc = await loadingTask.promise
        cleanup.push(() => { void doc.destroy() })
        const page = await doc.getPage(1)
        const viewport = page.getViewport({ scale: 1.2 })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('PDF render: 2D context unavailable')
        const task = page.render({ canvas, canvasContext: ctx, viewport })
        cleanup.push(() => { task.cancel() })
        await task.promise
        setBusy(false)
      } catch (err) {
        if (active.value) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      active.value = false
      for (const fn of cleanup) fn()
    }
  }, [bytes])

  return (
    <div className="document-preview document-preview__pdf" data-testid="document-preview-pdf" data-kind={kind} data-artifact-id={artifactId}>
      <h3 className="document-preview__title">{title}</h3>
      {busy ? <p>加载 PDF…</p> : null}
      {error ? <p className="document-preview__error">PDF 渲染失败：{error}</p> : null}
      <canvas ref={canvasRef} aria-label={title} />
    </div>
  )
}
