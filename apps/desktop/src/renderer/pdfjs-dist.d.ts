declare module 'pdfjs-dist/build/pdf.mjs' {
  export interface PdfViewport {
    width: number
    height: number
  }

  export interface PdfRenderTask {
    promise: Promise<void>
    cancel: () => void
  }

  export interface PdfPageProxy {
    getViewport: (input: { scale: number }) => PdfViewport
    render: (input: {
      canvas: HTMLCanvasElement
      canvasContext: CanvasRenderingContext2D
      viewport: PdfViewport
    }) => PdfRenderTask
  }

  export interface PdfDocumentProxy {
    numPages: number
    getPage: (pageNumber: number) => Promise<PdfPageProxy>
    destroy: () => Promise<void>
  }

  export interface PdfLoadingTask {
    promise: Promise<PdfDocumentProxy>
    destroy: () => Promise<void>
  }

  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(input: { data: Uint8Array }): PdfLoadingTask
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const workerUrl: string
  export default workerUrl
}
