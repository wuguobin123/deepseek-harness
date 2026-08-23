/**
 * 顶栏更新标记（方案 A：轻量版本检查 + 浏览器下载安装）。
 *
 * 默认灰色下载 icon（点击手动检查）；主进程轮询发现新版本时 icon 带红点 +
 * 「新版本」标记，点击弹小卡片：版本对比、release notes、[下载更新]（系统
 * 浏览器打开安装包 URL，mac 未签名故走手动安装）、[稍后]（关卡片，红点保留）。
 */
import * as React from 'react';
import { IconDownload } from './icons';
import { useAppUpdateStore } from '../stores/app-update';

export function UpdateBadge(): JSX.Element {
  const state = useAppUpdateStore((s) => s.state);
  const checking = useAppUpdateStore((s) => s.checking);
  const initialize = useAppUpdateStore((s) => s.initialize);
  const check = useAppUpdateStore((s) => s.check);
  const openDownload = useAppUpdateStore((s) => s.openDownload);

  const [open, setOpen] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void initialize();
  }, [initialize]);

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const available = state?.status === 'available';

  function handleTriggerClick(): void {
    if (available) {
      setOpen((v) => !v);
      return;
    }
    void check();
  }

  async function handleDownload(): Promise<void> {
    setOpenError(null);
    const result = await openDownload();
    if (!result.ok) {
      setOpenError(result.error ?? '无法打开下载地址');
    }
  }

  return (
    <div className="topbar__update">
      <button
        ref={buttonRef}
        type="button"
        className={`topbar__icon topbar__update-trigger ${available ? 'has-update' : ''}`}
        aria-label={available ? '发现新版本' : '检查更新'}
        title={checking ? '正在检查更新…' : available ? `新版本 ${state?.latestVersion ?? ''}` : '检查更新'}
        onClick={handleTriggerClick}
        data-testid="update-badge-trigger"
      >
        <IconDownload size={16} />
        {available ? <span className="topbar__update-dot" aria-hidden="true" /> : null}
      </button>
      {available ? (
        <span className="topbar__update-label" data-testid="update-badge-label">新版本</span>
      ) : null}
      {open && available && state ? (
        <div
          ref={popoverRef}
          className="update-popover"
          role="dialog"
          aria-label="客户端更新"
          data-testid="update-popover"
        >
          <div className="update-popover__header">
            <IconDownload size={13} />
            <span>客户端更新</span>
          </div>
          <div className="update-popover__body">
            <p className="update-popover__versions">
              <span>当前 {state.currentVersion}</span>
              <span aria-hidden="true">→</span>
              <strong>最新 {state.latestVersion}</strong>
            </p>
            {state.notes ? <p className="update-popover__notes">{state.notes}</p> : null}
            {!state.downloadUrl ? (
              <p className="update-popover__notes">当前平台暂无安装包，请稍后再试。</p>
            ) : null}
            {openError ? <p className="err">{openError}</p> : null}
          </div>
          <footer className="update-popover__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setOpen(false)}
              data-testid="update-later"
            >
              稍后
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!state.downloadUrl}
              onClick={() => void handleDownload()}
              data-testid="update-download"
            >
              下载更新
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
