import React from 'react';
import {
  IconArrowLeft,
  IconArrowRight,
  IconClose,
  IconDownload,
  IconExternalLink,
  IconGlobe,
  IconRefresh
} from '../../components/icons';
import { RightPanelSwitcher } from '../right-panel/RightPanelSwitcher';
import { useDocumentPreview } from '../document-preview/DocumentPreviewContext';
import { useBrowserWorkspace } from './BrowserWorkspaceContext';
import { workbenchApi } from '../../api';

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPanel({
  onOpenFiles,
  onOpenBrowser
}: {
  onOpenFiles: () => void;
  onOpenBrowser: () => void;
}): JSX.Element | null {
  const { state, close, navigate, execute } = useBrowserWorkspace();
  const { artifacts } = useDocumentPreview();
  const [address, setAddress] = React.useState(state.url);
  const [editingAddress, setEditingAddress] = React.useState(false);
  const [exportingPptx, setExportingPptx] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState<string | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!editingAddress) setAddress(state.url);
  }, [editingAddress, state.url]);

  const navigateAddress = React.useCallback(() => {
    const url = normalizeAddress(address);
    if (!url) return;
    setEditingAddress(false);
    setAddress(url);
    void navigate(url);
  }, [address, navigate]);

  const exportPptx = React.useCallback(async () => {
    if (!state.artifactId || !state.artifactDisplayName) return;
    setExportingPptx(true);
    setExportMessage(null);
    try {
      const result = await window.workbenchApi.exportArtifactToPptx({
        artifactId: state.artifactId,
        displayName: state.artifactDisplayName
      });
      setExportMessage(
        result.ok
          ? result.path
            ? `已保存到 ${result.path}`
            : 'PPTX 已生成'
          : result.error || 'PPTX 导出失败'
      );
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExportingPptx(false);
    }
  }, [state.artifactDisplayName, state.artifactId]);

  const openInSystemBrowser = React.useCallback(async () => {
    console.log('[BrowserPanel.openInSystemBrowser] clicked, state.url=', state.url);
    const url = state.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      console.warn('[BrowserPanel.openInSystemBrowser] abort: url invalid');
      setExportMessage('当前页面没有可用的 HTTP(S) 地址');
      return;
    }
    setExportMessage(null);
    // 如果当前 URL 是 artifact preview 链接，需要先申请一次性签名 token，
    // 否则在系统浏览器里打开会被后端 401（缺少 X-Tenant-ID / X-Actor-ID）。
    // 非 preview URL 直接原样打开。
    const previewMatch = url.match(/\/api\/artifacts\/([^/?#]+)\/preview\/?$/);
    let targetUrl = url;
    if (previewMatch) {
      const artifactId = previewMatch[1];
      console.log('[BrowserPanel.openInSystemBrowser] preview URL detected, minting token for', artifactId);
      try {
        // 5s 超时防止 preview-token 永久挂起。直接复用 api.ts 里的
        // requestArtifactPreviewToken 包装（它内部用 okBody 解包 {status, body}），
        // 不绕开以免再遇到 response shape 不一致的问题。
        const tokenPromise = workbenchApi.requestArtifactPreviewToken({ artifactId });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('preview-token request timed out after 5s')), 5000)
        );
        const tokenResult = await Promise.race([tokenPromise, timeoutPromise]);
        console.log('[BrowserPanel.openInSystemBrowser] token result', JSON.stringify(tokenResult));
        if (tokenResult.ok) {
          const sep = url.includes('?') ? '&' : '?';
          targetUrl = `${url}${sep}token=${encodeURIComponent(tokenResult.token)}`;
        } else {
          console.warn('[BrowserPanel.openInSystemBrowser] token error:', tokenResult.error);
          setExportMessage(
            tokenResult.error || '无法生成预览 token，跳出失败'
          );
          return;
        }
      } catch (error) {
        console.error('[BrowserPanel.openInSystemBrowser] token fetch threw:', error);
        setExportMessage(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    try {
      console.log('[BrowserPanel.openInSystemBrowser] calling openExternalUrl', targetUrl);
      const result = await window.workbenchApi.openExternalUrl(targetUrl);
      console.log('[BrowserPanel.openInSystemBrowser] result', result);
      if (!result.ok) {
        setExportMessage(result.error || '在系统浏览器打开失败');
      }
    } catch (error) {
      console.error('[BrowserPanel.openInSystemBrowser] threw', error);
      setExportMessage(error instanceof Error ? error.message : String(error));
    }
  }, [state.url]);

  React.useLayoutEffect(() => {
    if (!state.visible) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const syncBounds = () => {
      const bounds = surface.getBoundingClientRect();
      void window.workbenchApi.browserSetBounds({
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height))
      });
    };
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(surface);
    window.addEventListener('resize', syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [state.visible]);

  if (!state.visible) return null;

  return (
    <aside className="browser-panel" data-testid="browser-panel" aria-label="内置浏览器">
      <RightPanelSwitcher
        activeMode="browser"
        fileCount={artifacts.length}
        onOpenFiles={onOpenFiles}
        onOpenBrowser={onOpenBrowser}
        onClose={() => void close()}
        closeTestId="browser-close"
      />
      <header className="browser-panel__header">
        <div>
          <IconGlobe size={15} />
          <strong>浏览器</strong>
          <span className={state.lastError ? 'is-error' : ''}>
            {state.lastError ? '加载失败' : state.isLoading ? '加载中' : '已连接'}
          </span>
        </div>
        <span>输入网址或搜索内容</span>
      </header>
      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-toolbar__button"
          aria-label="后退"
          disabled={!state.canGoBack}
          onClick={() => void execute({ type: 'back' })}
        >
          <IconArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="browser-toolbar__button"
          aria-label="前进"
          disabled={!state.canGoForward}
          onClick={() => void execute({ type: 'forward' })}
        >
          <IconArrowRight size={15} />
        </button>
        <button
          type="button"
          className="browser-toolbar__button"
          aria-label={state.isLoading ? '停止加载' : '刷新'}
          onClick={() =>
            void execute({ type: state.isLoading ? 'stop' : 'reload' })
          }
        >
          {state.isLoading ? <IconClose size={14} /> : <IconRefresh size={14} />}
        </button>
        <button
          type="button"
          className="browser-toolbar__button"
          aria-label="在系统浏览器打开"
          title="在系统默认浏览器新窗口打开当前页面"
          disabled={!state.url || !/^https?:\/\//i.test(state.url)}
          onClick={() => void openInSystemBrowser()}
          data-testid="browser-open-external"
        >
          <IconExternalLink size={14} />
        </button>
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            navigateAddress();
          }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => setEditingAddress(true)}
            onBlur={() => setEditingAddress(false)}
            aria-label="浏览器地址"
            placeholder="输入网址或搜索内容"
            data-testid="browser-address"
          />
        </form>
      </div>
      {state.lastError ? (
        <div className="browser-panel__error" role="alert">
          {state.lastError}
        </div>
      ) : null}
      <div
        className="browser-surface"
        ref={surfaceRef}
        data-testid="browser-surface"
      >
        {state.mode === 'preview' ? (
          <div className="browser-preview">
            <IconGlobe size={28} />
            <strong>{state.title || '浏览器预览'}</strong>
            <p>
              {state.url
                ? `开发预览已导航到 ${state.url}`
                : '通过助手描述要打开、搜索或总结的网页。'}
            </p>
            <small>真实网页内容会显示在 Electron 桌面应用的这个区域。</small>
          </div>
        ) : null}
      </div>
      <footer className="browser-panel__footer">
        <span>
          <i className={state.lastError ? 'is-error' : ''} />
          {state.lastError ? state.lastError : state.title || '等待打开网页'}
        </span>
        {state.artifactId && /\.html?$/i.test(state.artifactDisplayName || '') ? (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => void exportPptx()}
            disabled={exportingPptx}
            data-testid="browser-export-pptx"
            title="按当前浏览器渲染效果导出 PowerPoint"
          >
            <IconDownload size={13} />
            {exportingPptx ? '正在生成…' : '下载 PPT'}
          </button>
        ) : (
          <small>{state.mode === 'native' ? '安全隔离浏览器' : '开发预览'}</small>
        )}
      </footer>
      {exportMessage ? (
        <div className="browser-panel__export-message" role="status">
          {exportMessage}
        </div>
      ) : null}
    </aside>
  );
}
