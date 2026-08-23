import React from 'react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type {
  PdfDocumentProxy,
  PdfLoadingTask
} from 'pdfjs-dist/build/pdf.mjs';

const MAX_PREVIEW_PAGES = 100;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type RenderState = {
  status: 'loading' | 'rendering' | 'ready' | 'error';
  renderedPages: number;
  totalPages: number;
  error: string | null;
};

const INITIAL_STATE: RenderState = {
  status: 'loading',
  renderedPages: 0,
  totalPages: 0,
  error: null
};

export function PdfPreview({
  dataBase64,
  displayName
}: {
  dataBase64: string;
  displayName: string;
}): JSX.Element {
  const pagesRef = React.useRef<HTMLDivElement | null>(null);
  const [renderState, setRenderState] = React.useState<RenderState>(INITIAL_STATE);

  React.useEffect(() => {
    const pagesElement = pagesRef.current;
    if (!pagesElement) return undefined;

    let active = true;
    let loadingTask: PdfLoadingTask | undefined;
    let documentProxy: PdfDocumentProxy | undefined;
    const renderTasks: Array<{ cancel: () => void }> = [];
    pagesElement.replaceChildren();
    setRenderState(INITIAL_STATE);

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ data: decodeBase64(dataBase64) });
        const pdfDocument = await loadingTask.promise;
        documentProxy = pdfDocument;
        if (!active) return;

        const pageLimit = Math.min(pdfDocument.numPages, MAX_PREVIEW_PAGES);
        setRenderState({
          status: 'rendering',
          renderedPages: 0,
          totalPages: pdfDocument.numPages,
          error: null
        });

        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
          if (!active) return;
          const page = await pdfDocument.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(240, pagesElement.clientWidth - 32);
          const cssScale = Math.min(2, availableWidth / baseViewport.width);
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);
          const renderViewport = page.getViewport({
            scale: cssScale * outputScale
          });

          const pageElement = document.createElement('section');
          pageElement.className = 'document-preview__pdf-page';
          pageElement.setAttribute('aria-label', `第 ${pageNumber} 页`);
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          canvas.style.width = `${Math.ceil(renderViewport.width / outputScale)}px`;
          canvas.style.height = `${Math.ceil(renderViewport.height / outputScale)}px`;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('无法创建 PDF Canvas 上下文');
          pageElement.append(canvas);
          pagesElement.append(pageElement);

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport: renderViewport
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
          if (!active) return;
          setRenderState((previous) => ({
            ...previous,
            renderedPages: pageNumber,
            status: pageNumber === pageLimit ? 'ready' : 'rendering'
          }));
        }
      } catch (error) {
        if (!active) return;
        setRenderState({
          status: 'error',
          renderedPages: 0,
          totalPages: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })();

    return () => {
      active = false;
      for (const task of renderTasks) task.cancel();
      void documentProxy?.destroy();
      void loadingTask?.destroy();
    };
  }, [dataBase64]);

  const truncated = renderState.totalPages > MAX_PREVIEW_PAGES;

  return (
    <div
      className="document-preview__pdf"
      data-testid="document-preview-pdf"
      data-page-count={renderState.totalPages}
      aria-label={`${displayName} PDF 预览`}
    >
      <div className="document-preview__pdf-status" aria-live="polite">
        {renderState.status === 'loading'
          ? '正在加载 PDF…'
          : renderState.status === 'error'
            ? `PDF 预览失败：${renderState.error}`
            : `PDF · ${renderState.totalPages} 页 · 已渲染 ${renderState.renderedPages} 页${
                truncated ? `（最多预览 ${MAX_PREVIEW_PAGES} 页）` : ''
              }`}
      </div>
      <div className="document-preview__pdf-pages" ref={pagesRef} />
    </div>
  );
}
