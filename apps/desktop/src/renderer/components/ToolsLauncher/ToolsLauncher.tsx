import * as React from 'react';
import {
  IconClose,
  IconFile,
  IconGlobe,
  IconPanelRight,
} from '../icons';
import { useDocumentPreview } from '../../features/document-preview/DocumentPreviewContext';
import { useBrowserWorkspace } from '../../features/browser/BrowserWorkspaceContext';
import { useAssistant } from '../../features/assistant/AssistantContext';

interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: JSX.Element;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
}

export function ToolsLauncher(): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const docPreview = useDocumentPreview();
  const browser = useBrowserWorkspace();
  const { openFilesPanel, openBrowserPanel } = useAssistant();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

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

  // 工具列表
  const tools: ToolEntry[] = [
    {
      id: 'files',
      label: '文件',
      description: `查看与预览已生成的文件（${docPreview.artifacts.length}）`,
      icon: <IconFile size={14} />,
      shortcut: '⌘⇧F',
      active: docPreview.visible,
      onClick: () => {
        setOpen(false);
        openFilesPanel();
      }
    },
    {
      id: 'browser',
      label: '浏览器',
      description: '在右侧打开网页和搜索',
      icon: <IconGlobe size={14} />,
      shortcut: '⌘⇧B',
      active: browser.state.visible,
      onClick: () => {
        setOpen(false);
        void openBrowserPanel();
      }
    }
  ];

  return (
    <div className="tools-launcher">
      <button
        ref={buttonRef}
        type="button"
        className={`topbar__icon tools-launcher__trigger ${
          open || docPreview.visible || browser.state.visible ? 'is-active' : ''
        }`}
        aria-label="打开右侧面板"
        title="打开侧栏"
        onClick={() => setOpen((v) => !v)}
        data-testid="tools-launcher-trigger"
      >
        {open ? <IconClose size={16} /> : <IconPanelRight size={16} />}
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className="tools-launcher__popover"
          role="dialog"
          aria-label="选择右侧面板"
          data-testid="tools-launcher-popover"
        >
          <div className="tools-launcher__header">
            <IconPanelRight size={13} />
            <span>打开侧栏</span>
          </div>
          <ul className="tools-launcher__list">
            {tools.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  className={`tools-launcher__item ${tool.active ? 'is-active' : ''}`}
                  onClick={() => tool.onClick?.()}
                  data-testid={`tools-launcher-${tool.id}`}
                >
                  <span className="tools-launcher__item-icon">
                    {tool.icon}
                  </span>
                  <span className="tools-launcher__item-info">
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                  </span>
                  {tool.shortcut ? (
                    <kbd className="tools-launcher__item-kbd">
                      {tool.shortcut}
                    </kbd>
                  ) : null}
                  {tool.active ? (
                    <span className="tools-launcher__item-active">已打开</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
