import { IconClose, IconFile, IconGlobe } from '../../components/icons';

export type RightPanelMode = 'files' | 'browser';

interface RightPanelSwitcherProps {
  activeMode: RightPanelMode;
  fileCount: number;
  onOpenFiles: () => void;
  onOpenBrowser: () => void;
  onClose: () => void;
  closeTestId: 'document-preview-close' | 'browser-close';
}

export function RightPanelSwitcher({
  activeMode,
  fileCount,
  onOpenFiles,
  onOpenBrowser,
  onClose,
  closeTestId
}: RightPanelSwitcherProps): JSX.Element {
  return (
    <header
      className="right-panel-switcher"
      data-testid="right-panel-switcher"
    >
      <div
        className="right-panel-switcher__tabs"
        role="tablist"
        aria-label="右侧面板"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'files'}
          className={activeMode === 'files' ? 'is-active' : ''}
          onClick={onOpenFiles}
          data-testid="right-panel-files-tab"
        >
          <IconFile size={14} />
          <span>文件</span>
          <small>{fileCount}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'browser'}
          className={activeMode === 'browser' ? 'is-active' : ''}
          onClick={onOpenBrowser}
          data-testid="right-panel-browser-tab"
        >
          <IconGlobe size={14} />
          <span>浏览器</span>
        </button>
      </div>
      <button
        type="button"
        className="right-panel-switcher__close"
        aria-label="关闭右侧面板"
        title="关闭侧栏"
        onClick={onClose}
        data-testid={closeTestId}
      >
        <span data-testid="right-panel-close">
          <IconClose size={15} />
        </span>
      </button>
    </header>
  );
}
