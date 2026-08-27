/**
 * DocumentPreviewPanel — right-side panel listing all artifacts for the
 * active workspace + session and rendering the selected one in-place.
 *
 * Hosts a list of `ArtifactView` cards (one per artifact, sorted newest
 * first) and the DocumentPreview component. The parent wires it into
 * the conversation details column. Selection is transient per session; the
 * durable artifact id remains in the logged tool result.
 *
 * This is the xiaowei 4-class delivery surface: `tool-html` /
 * `tool-slides` / `tool-doc` / `tool-sheet` / `tool-chart` all write to
 * the same registry, so a single panel renders every kind.
 */
import React from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactKind, ArtifactView } from '../../api'
import { artifact } from '../../api'
import { IconDownload, IconExternalLink, IconRefresh } from '../../components/icons'
import { DocumentPreview } from './DocumentPreview'

export interface DocumentPreviewPanelProps {
  workspaceId?: string
  sessionId?: string
  initialArtifactId?: string
  /** Filter to a single kind (e.g. show only `slides`). */
  kindFilter?: ArtifactKind
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: 'HTML',
  slides: '幻灯',
  doc: '文档',
  sheet: '表格',
  chart: '图表',
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function FullScreenIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {active ? (
        <>
          <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
        </>
      ) : (
        <>
          <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        </>
      )}
    </svg>
  )
}

export function DocumentPreviewPanel({
  workspaceId,
  sessionId,
  initialArtifactId,
  kindFilter,
}: DocumentPreviewPanelProps): React.JSX.Element {
  const [items, setItems] = React.useState<ArtifactView[] | null>(null)
  const [active, setActive] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [fullScreen, setFullScreen] = React.useState(false)
  const [action, setAction] = React.useState<'download' | 'browser' | null>(null)
  const [actionMessage, setActionMessage] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await artifact.list({ workspaceId: workspaceId || undefined, sessionId, kind: kindFilter })
      const sorted = [...result.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      setItems(sorted)
      setActive((prev) => {
        if (prev && sorted.some(it => it.artifactId === prev)) return prev
        if (initialArtifactId && sorted.some(it => it.artifactId === initialArtifactId)) return initialArtifactId
        return sorted[0]?.artifactId ?? null
      })
    } catch (err) {
      setError((err as Error).message)
      setItems(null)
    } finally {
      setBusy(false)
    }
  }, [workspaceId, sessionId, kindFilter, initialArtifactId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (!fullScreen) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullScreen(false)
    }
    document.addEventListener('keydown', close)
    return () =>{  document.removeEventListener('keydown', close) }
  }, [fullScreen])

  React.useEffect(() => {
    setFullScreen(false)
    setActionMessage(null)
  }, [sessionId])

  const activeView = items?.find(item => item.artifactId === active) ?? null

  const downloadActive = React.useCallback(async () => {
    if (active === null) return
    setAction('download')
    setActionMessage(null)
    try {
      const result = await artifact.save({ artifactId: active })
      if (result.status === 'saved') setActionMessage('已保存到本地')
    } catch (actionError) {
      setActionMessage(`下载失败：${(actionError as Error).message}`)
    } finally {
      setAction(null)
    }
  }, [active])

  const openActiveInBrowser = React.useCallback(async () => {
    if (active === null) return
    setAction('browser')
    setActionMessage(null)
    try {
      await artifact.openInBrowser({ artifactId: active })
      setActionMessage('已使用默认浏览器打开')
    } catch (actionError) {
      setActionMessage(`打开失败：${(actionError as Error).message}`)
    } finally {
      setAction(null)
    }
  }, [active])

  const panel = (
    <section
      className={`document-preview-panel${fullScreen ? ' document-preview-panel--fullscreen' : ''}`}
      data-testid="document-preview-panel"
      data-fullscreen={fullScreen || undefined}
      role={fullScreen ? 'dialog' : undefined}
      aria-modal={fullScreen ? true : undefined}
      aria-label={fullScreen ? '产物全屏预览' : undefined}
    >
      <header className="document-preview-panel__header">
        {activeView ? (
          <div className="document-preview-panel__summary">
            <span className="document-preview-panel__summary-kind">{KIND_LABEL[activeView.kind]}</span>
            <span className="document-preview-panel__summary-copy">
              <strong title={activeView.title ?? activeView.name}>{activeView.title ?? activeView.name ?? activeView.artifactId}</strong>
              <small>{formatBytes(activeView.bytes)} · {activeView.mediaType}</small>
            </span>
          </div>
        ) : (
          <span className="document-preview-panel__summary-placeholder">选择产物后预览</span>
        )}
        <div className="document-preview-panel__actions">
          {activeView?.mediaType === 'text/html' ? (
            <button
              type="button"
              onClick={() => void openActiveInBrowser()}
              disabled={action !== null}
              data-testid="document-preview-panel-open-browser"
              aria-label={action === 'browser' ? '正在使用默认浏览器打开' : '使用默认浏览器打开'}
              title="使用系统默认浏览器打开受限副本"
            >
              <IconExternalLink size={16} />
            </button>
          ) : null}
          {activeView ? (
            <button
              type="button"
              onClick={() =>{  setFullScreen(value => !value) }}
              data-testid="document-preview-panel-fullscreen"
              aria-label={fullScreen ? '退出全屏预览' : '全屏预览'}
              title={fullScreen ? '退出全屏（Esc）' : '全屏预览'}
            >
              <FullScreenIcon active={fullScreen} />
            </button>
          ) : null}
          {activeView ? (
            <button
              type="button"
              onClick={() => void downloadActive()}
              disabled={action !== null}
              data-testid="document-preview-panel-download"
              aria-label={action === 'download' ? '正在保存原始产物' : '下载原始产物'}
              title="下载原始产物"
            >
              <IconDownload size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            data-testid="document-preview-panel-refresh"
            aria-label={busy ? '正在刷新产物列表' : '刷新产物列表'}
            title="刷新产物列表"
          >
            <IconRefresh size={16} className={busy ? 'is-spinning' : undefined} />
          </button>
        </div>
      </header>
      {actionMessage ? (
        <p className="document-preview-panel__action-message" role="status">{actionMessage}</p>
      ) : null}
      {error ? (
        <p className="document-preview-panel__error" role="alert">{error}</p>
      ) : items === null ? (
        <p className="document-preview-panel__hint">加载中…</p>
      ) : items.length === 0 ? (
        <p className="document-preview-panel__hint" data-testid="document-preview-panel-empty">
          暂无产物。让模型调用 <code>html_build</code> / <code>slides_build</code> /
          <code>doc_build</code> / <code>sheet_build</code> / <code>mermaid_build</code> /
          <code>svg_build</code> 即可生成。
        </p>
      ) : (
        <>
          <section className="document-preview-panel__collection" aria-labelledby="artifact-collection-title">
            <div className="document-preview-panel__collection-header">
              <span id="artifact-collection-title">全部产物</span>
              <span className="document-preview-panel__count" data-testid="document-preview-panel-count">{items.length}</span>
            </div>
            <ul className="document-preview-panel__list" data-testid="document-preview-panel-list">
              {items.map(it => (
                <li
                  key={it.artifactId}
                  className={`document-preview-panel__item ${active === it.artifactId ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() =>{  setActive(it.artifactId) }}
                    data-testid="document-preview-panel-item"
                    data-artifact-id={it.artifactId}
                    data-kind={it.kind}
                    aria-current={active === it.artifactId ? 'true' : undefined}
                  >
                    <span className="document-preview-panel__kind">{KIND_LABEL[it.kind]}</span>
                    <span className="document-preview-panel__title">{it.title ?? it.name ?? it.artifactId}</span>
                    <span className="document-preview-panel__meta">
                      {formatBytes(it.bytes)} · {it.mediaType}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <div className="document-preview-panel__viewer" data-testid="document-preview-panel-viewer">
            {active ? (
              <DocumentPreview
                artifactId={active}
                reloadKey={active}
              />
            ) : (
              <p>选择左侧产物以预览。</p>
            )}
          </div>
        </>
      )}
    </section>
  )

  return fullScreen ? createPortal(panel, document.body) : panel
}
