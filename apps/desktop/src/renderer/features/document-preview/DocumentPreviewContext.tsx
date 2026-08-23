import React from 'react';
import { workbenchApi } from '../../api';

export type GeneratedArtifact = {
  artifactId: string;
  displayName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  artifactType?: string;
  createdAt?: string | null;
};

interface DocumentPreviewState {
  visible: boolean;
  activeArtifact: GeneratedArtifact | null;
  artifacts: GeneratedArtifact[];
  previewUrl: string | null;
  previewKind: 'iframe' | 'image' | null;
  pdfDataBase64: string | null;
  markdownContent: string | null;
  loading: boolean;
}

export type ArtifactPreviewStrategy =
  | 'markdown'
  | 'pdf'
  | 'office'
  | 'html'
  | 'image'
  | 'fallback';

function artifactExtension(displayName: string): string {
  const dotIndex = displayName.lastIndexOf('.');
  return dotIndex >= 0 ? displayName.slice(dotIndex).toLowerCase() : '';
}

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function artifactImageMimeType(artifact: GeneratedArtifact): string {
  const mimeType = artifact.mimeType?.toLowerCase() ?? '';
  if (mimeType.startsWith('image/')) return mimeType;
  return IMAGE_MIME_BY_EXTENSION[artifactExtension(artifact.displayName)] ?? '';
}

function base64BlobUrl(dataBase64: string, mimeType: string): string {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** Single source of truth for choosing the preview capability for a file. */
export function artifactPreviewStrategy(
  artifact: GeneratedArtifact
): ArtifactPreviewStrategy {
  const extension = artifactExtension(artifact.displayName);
  const mimeType = artifact.mimeType?.toLowerCase() ?? '';
  if (
    mimeType === 'text/markdown' ||
    extension === '.md' ||
    extension === '.markdown'
  ) {
    return 'markdown';
  }
  if (mimeType.includes('text/html') || ['.html', '.htm'].includes(extension)) {
    return 'html';
  }
  if (mimeType === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (mimeType.startsWith('image/') || extension in IMAGE_MIME_BY_EXTENSION) {
    return 'image';
  }
  if (
    ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)
  ) {
    return 'office';
  }
  return 'fallback';
}

interface DocumentPreviewContextValue extends DocumentPreviewState {
  open: (artifact: GeneratedArtifact) => void;
  openList: () => void;
  close: () => void;
  addArtifact: (artifact: GeneratedArtifact) => void;
  setArtifacts: (artifacts: GeneratedArtifact[]) => void;
  clearArtifacts: () => void;
  downloadArtifact: (artifactId: string) => Promise<void>;
  openArtifactExternal: (artifactId: string) => Promise<{ ok: boolean; path?: string; error?: string } | undefined>;
}

const DocumentPreviewContext =
  React.createContext<DocumentPreviewContextValue | null>(null);

export function DocumentPreviewProvider({
  children
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [state, setState] = React.useState<DocumentPreviewState>({
    visible: false,
    activeArtifact: null,
    artifacts: [],
    previewUrl: null,
    previewKind: null,
    pdfDataBase64: null,
    markdownContent: null,
    loading: false
  });
  const previewRequestId = React.useRef(0);

  // 只打开面板到文件列表视图，不触发任何预览加载
  const openList = React.useCallback(() => {
    previewRequestId.current += 1;
    setState((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        ...prev,
        visible: true,
        activeArtifact: null,
        previewUrl: null,
        previewKind: null,
        pdfDataBase64: null,
        markdownContent: null,
        loading: false
      };
    });
  }, []);

  const loadPreview = React.useCallback(async (
    artifact: GeneratedArtifact,
    requestId: number
  ) => {
    const commit = (
      next: Pick<
        DocumentPreviewState,
        'previewUrl' | 'previewKind' | 'pdfDataBase64' | 'markdownContent'
      >
    ) => {
      if (previewRequestId.current !== requestId) {
        if (next.previewUrl) URL.revokeObjectURL(next.previewUrl);
        return;
      }
      setState((prev) => {
        if (prev.previewUrl && prev.previewUrl !== next.previewUrl) {
          URL.revokeObjectURL(prev.previewUrl);
        }
        return { ...prev, ...next, loading: false };
      });
    };

    try {
      const strategy = artifactPreviewStrategy(artifact);

      // Markdown 由客户端完整的 React Markdown + GFM 渲染器直接渲染。
      if (strategy === 'markdown') {
        const content = await workbenchApi.request({
          method: 'GET',
          path: `/api/artifacts/${encodeURIComponent(artifact.artifactId)}/content`
        });
        if (content.status >= 200 && content.status < 300) {
          commit({
            previewUrl: null,
            previewKind: null,
            pdfDataBase64: null,
            markdownContent:
              typeof content.body === 'string'
                ? content.body
                : String(content.body ?? '')
          });
          return;
        }
      }

      // 图片直接读取原始 artifact 内容，使用 blob: URL 在隔离的渲染层展示。
      if (strategy === 'image') {
        const image = await window.workbenchApi?.readArtifactContent?.(
          artifact.artifactId
        );
        if (image?.ok) {
          commit({
            previewUrl: base64BlobUrl(
              image.dataBase64,
              artifactImageMimeType(artifact) || 'application/octet-stream'
            ),
            previewKind: 'image',
            pdfDataBase64: null,
            markdownContent: null
          });
          return;
        }
        commit({
          previewUrl: null,
          previewKind: null,
          pdfDataBase64: null,
          markdownContent: null
        });
        return;
      }

      // PDF 交给内嵌 PDF.js；Office 文件先用 LibreOffice 转成 PDF。
      if (strategy === 'pdf' || strategy === 'office') {
        const convertResult = await window.workbenchApi?.convertArtifactToPdf?.(
          artifact.artifactId
        );
        if (convertResult?.ok) {
          const read = await window.workbenchApi?.readLocalPdf?.(convertResult.pdfPath);
          if (read?.ok) {
            commit({
              previewUrl: null,
              previewKind: null,
              pdfDataBase64: read.dataBase64,
              markdownContent: null
            });
            return;
          }
        }
      }

      // 文本、表格及无法原生转换的 Office 文件使用后端类型化预览。
      const res = await workbenchApi.request({
        method: 'GET',
        path: `/api/artifacts/${encodeURIComponent(artifact.artifactId)}/preview`
      });
      if (res.status >= 200 && res.status < 300) {
        const html = typeof res.body === 'string' ? res.body : String(res.body);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        commit({
          previewUrl: URL.createObjectURL(blob),
          previewKind: 'iframe',
          pdfDataBase64: null,
          markdownContent: null
        });
      } else {
        commit({
          previewUrl: null,
          previewKind: null,
          pdfDataBase64: null,
          markdownContent: null
        });
      }
    } catch (error) {
      console.warn('[document-preview] 预览加载失败', error);
      commit({
        previewUrl: null,
        previewKind: null,
        pdfDataBase64: null,
        markdownContent: null
      });
    }
  }, []);

  const open = React.useCallback((artifact: GeneratedArtifact) => {
    const requestId = ++previewRequestId.current;
    setState((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        ...prev,
        visible: true,
        activeArtifact: artifact,
        previewUrl: null,
        previewKind: null,
        pdfDataBase64: null,
        markdownContent: null,
        loading: true
      };
    });
    void loadPreview(artifact, requestId);
  }, [loadPreview]);

  const close = React.useCallback(() => {
    previewRequestId.current += 1;
    setState((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        ...prev,
        visible: false,
        previewUrl: null,
        previewKind: null,
        pdfDataBase64: null,
        markdownContent: null,
        loading: false
      };
    });
  }, []);

  const addArtifact = React.useCallback((artifact: GeneratedArtifact) => {
    setState((prev) => ({
      ...prev,
      artifacts: [
        artifact,
        ...prev.artifacts.filter((a) => a.artifactId !== artifact.artifactId)
      ]
    }));
  }, []);

  const setArtifacts = React.useCallback((artifacts: GeneratedArtifact[]) => {
    setState((prev) => {
      // 切换会话时若正在预览的文件不属于新列表，退回纯列表态，避免残留旧会话内容
      const activeStale =
        prev.activeArtifact !== null &&
        !artifacts.some((a) => a.artifactId === prev.activeArtifact?.artifactId);
      if (activeStale) {
        previewRequestId.current += 1;
        if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        ...prev,
        artifacts,
        ...(activeStale
          ? {
              activeArtifact: null,
              previewUrl: null,
              previewKind: null,
              pdfDataBase64: null,
              markdownContent: null,
              loading: false
            }
          : {})
      };
    });
  }, []);

  const clearArtifacts = React.useCallback(() => {
    previewRequestId.current += 1;
    setState((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        ...prev,
        artifacts: [],
        activeArtifact: null,
        previewUrl: null,
        previewKind: null,
        pdfDataBase64: null,
        markdownContent: null,
        loading: false,
        visible: false
      };
    });
  }, []);

  const downloadArtifact = React.useCallback(
    async (artifactId: string) => {
      try {
        // 通过主进程 IPC 下载到临时目录并调起系统默认应用打开
        // 效果：用户点击"下载"会触发系统下载弹窗（macOS 走系统下载）
        // 效果：用户点击"预览"会调用 PowerPoint/Word/Excel 等打开
        const result = await window.workbenchApi?.downloadArtifactFile?.(artifactId);
        if (result && !result.ok) {
          console.error('下载失败', result.error);
        }
      } catch (error) {
        console.error('下载失败', error);
      }
    },
    []
  );

  const openArtifactExternal = React.useCallback(
    async (artifactId: string) => {
      // 通过系统默认应用打开（PPT → PowerPoint/Keynote，Word → Word/WPS，PDF → Preview）
      return window.workbenchApi?.openArtifactFile?.(artifactId, 'open');
    },
    []
  );

  const value: DocumentPreviewContextValue = {
    ...state,
    open,
    openList,
    close,
    addArtifact,
    setArtifacts,
    clearArtifacts,
    downloadArtifact,
    openArtifactExternal
  };

  return (
    <DocumentPreviewContext.Provider value={value}>
      {children}
    </DocumentPreviewContext.Provider>
  );
}

export function useDocumentPreview(): DocumentPreviewContextValue {
  const value = React.useContext(DocumentPreviewContext);
  if (!value) {
    throw new Error(
      'useDocumentPreview must be used within DocumentPreviewProvider'
    );
  }
  return value;
}
