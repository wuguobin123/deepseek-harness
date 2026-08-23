import React from 'react';
import {
  IconDownload,
  IconFile,
  IconFileExcel,
  IconFilePdf,
  IconFilePpt,
  IconFileWord,
  IconFileText,
  IconEye
} from '../../components/icons';
import { MarkdownContent } from '../assistant/MarkdownContent';
import { RightPanelSwitcher } from '../right-panel/RightPanelSwitcher';
import {
  type GeneratedArtifact,
  useDocumentPreview
} from './DocumentPreviewContext';
import { PdfPreview } from './PdfPreview';

function fileIcon(displayName: string): JSX.Element {
  const ext = displayName.split('.').pop()?.toLowerCase() || '';
  if (['docx', 'doc'].includes(ext)) return <IconFileWord size={16} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <IconFileExcel size={16} />;
  if (['pptx', 'ppt'].includes(ext)) return <IconFilePpt size={16} />;
  if (ext === 'pdf') return <IconFilePdf size={16} />;
  if (['md', 'txt'].includes(ext)) return <IconFileText size={16} />;
  return <IconFile size={16} />;
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(displayName: string): string {
  const ext = displayName.split('.').pop()?.toUpperCase() || '';
  return ext || '文件';
}

export function DocumentPreviewPanel({
  onOpenArtifact,
  onOpenFiles,
  onOpenBrowser
}: {
  onOpenArtifact: (artifact: GeneratedArtifact) => void;
  onOpenFiles: () => void;
  onOpenBrowser: () => void;
}): JSX.Element | null {
  const [listCollapsed, setListCollapsed] = React.useState(false);
  const {
    visible,
    artifacts,
    activeArtifact,
    previewUrl,
    previewKind,
    pdfDataBase64,
    markdownContent,
    loading,
    close,
    downloadArtifact,
    openArtifactExternal
  } = useDocumentPreview();

  if (!visible) return null;

  // 纯列表态（openList 打开）：没有选中文件时列表强制展开，作为主视图
  const listOnly = activeArtifact === null;

  return (
    <aside
      className="document-preview-panel"
      data-testid="document-preview-panel"
      aria-label="文档预览"
    >
      <RightPanelSwitcher
        activeMode="files"
        fileCount={artifacts.length}
        onOpenFiles={onOpenFiles}
        onOpenBrowser={onOpenBrowser}
        onClose={() => void close()}
        closeTestId="document-preview-close"
      />
      <header className="document-preview__header">
        <div>
          <IconEye size={15} />
          <strong>文件预览</strong>
          <span>{artifacts.length} 个文件</span>
        </div>
        <span>{activeArtifact ? activeArtifact.displayName : '选择文件以预览'}</span>
      </header>

      {artifacts.length > 0 ? (
        <div className="document-preview__list">
          <div className="document-preview__list-title">
            <span>生成的文件</span>
            {!listOnly ? (
              <button
                type="button"
                className="document-preview__toggle"
                onClick={() => setListCollapsed((v) => !v)}
                aria-label={listCollapsed ? '展开文件列表' : '折叠文件列表'}
                title={listCollapsed ? '展开文件列表' : '折叠文件列表'}
              >
                {listCollapsed ? '展开' : '折叠'}
              </button>
            ) : null}
          </div>
          {!listCollapsed || listOnly ? (
            <ul>
              {artifacts.map((artifact) => (
                <li
                key={artifact.artifactId}
                className={
                  activeArtifact?.artifactId === artifact.artifactId
                    ? 'is-active'
                    : ''
                }
              >
                <button
                  type="button"
                  className="document-item"
                  onClick={() => onOpenArtifact(artifact)}
                >
                  <span className="document-item__icon">
                    {fileIcon(artifact.displayName)}
                  </span>
                  <div className="document-item__info">
                    <strong className="document-item__name">
                      {artifact.displayName}
                    </strong>
                    <small>
                      {fileTypeLabel(artifact.displayName)}
                      {artifact.sizeBytes
                        ? ` · ${formatSize(artifact.sizeBytes)}`
                        : ''}
                    </small>
                  </div>
                </button>
                <button
                  type="button"
                  className="document-item__download"
                  onClick={() => void downloadArtifact(artifact.artifactId)}
                  title="下载/用系统应用打开"
                  aria-label={`下载 ${artifact.displayName}`}
                >
                  <IconDownload size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      ) : null}

      <div className="document-preview__content">
        {!activeArtifact ? (
          <div className="document-preview__empty">
            <IconFile size={32} />
            <strong>暂无文件</strong>
            <p>生成的文档会显示在这里，支持在线预览和下载。</p>
          </div>
        ) : loading ? (
          <div className="document-preview__loading">
            <span className="spinner" />
            正在加载预览…
          </div>
        ) : pdfDataBase64 !== null ? (
          <PdfPreview
            dataBase64={pdfDataBase64}
            displayName={activeArtifact.displayName}
          />
        ) : markdownContent !== null ? (
          <div
            className="document-preview__markdown"
            data-testid="document-preview-markdown"
          >
            <MarkdownContent>{markdownContent}</MarkdownContent>
          </div>
        ) : previewUrl && previewKind === 'image' ? (
          <div className="document-preview__image-stage">
            <img
              src={previewUrl}
              alt={activeArtifact.displayName}
              className="document-preview__image"
              data-testid="document-preview-image"
            />
          </div>
        ) : previewUrl ? (
          <iframe
            src={previewUrl}
            title={activeArtifact.displayName}
            className="document-preview__iframe"
            sandbox="allow-scripts"
          />
        ) : (
          <div className="document-preview__error">
            <p>未能加载内嵌预览，请点击下方按钮用系统应用打开，或下载到本地查看。</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void openArtifactExternal(activeArtifact.artifactId)}
            >
              <IconDownload size={14} />
              用系统应用打开
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void downloadArtifact(activeArtifact.artifactId)}
            >
              下载到本地
            </button>
          </div>
        )}
      </div>

      {activeArtifact ? (
        <footer className="document-preview__footer">
          <div className="document-preview__footer-info">
            {fileIcon(activeArtifact.displayName)}
            <span>{activeArtifact.displayName}</span>
          </div>
          <div className="document-preview__footer-actions">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void downloadArtifact(activeArtifact.artifactId)}
              title="保存到本地"
            >
              <IconDownload size={13} />
              下载
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => void openArtifactExternal(activeArtifact.artifactId)}
              title="用 PowerPoint/Word/Excel 等系统应用打开"
            >
              打开
            </button>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}
