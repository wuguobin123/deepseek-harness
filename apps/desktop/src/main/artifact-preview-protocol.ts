/** Authenticated, non-file protocol for isolated HTML artifact frames. */
import { protocol } from 'electron'
import { decodeArtifact } from './artifact-files'
import { ARTIFACT_CSP, withArtifactCsp } from '../shared/artifact-html'

export const ARTIFACT_PREVIEW_SCHEME = 'xiaowei-artifact'

/** Register the preview scheme before Electron emits ready. */
export function registerArtifactPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: ARTIFACT_PREVIEW_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  }])
}

function response(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** Build the protocol handler; every request re-authorizes through readArtifact. */
export function createArtifactPreviewHandler(readArtifact: (artifactId: string) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return response(400, 'invalid artifact preview URL')
    }
    if (url.protocol !== `${ARTIFACT_PREVIEW_SCHEME}:` || url.hostname !== 'preview' || url.search !== '' || url.hash !== '') {
      return response(404, 'artifact preview not found')
    }
    let artifactId: string
    try {
      artifactId = decodeURIComponent(url.pathname.replace(/^\//, ''))
    } catch {
      return response(400, 'invalid artifact id')
    }
    if (artifactId.length === 0 || artifactId.includes('/')) return response(400, 'invalid artifact id')

    try {
      const { view, bytes } = decodeArtifact(await readArtifact(artifactId), artifactId)
      if (view.mediaType !== 'text/html') return response(415, 'artifact is not HTML')
      return new Response(withArtifactCsp(bytes.toString('utf8')), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': ARTIFACT_CSP,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return response(404, 'artifact preview not found')
    }
  }
}

/** Install the authenticated response handler after Electron is ready. */
export function registerArtifactPreviewProtocol(readArtifact: (artifactId: string) => Promise<unknown>): void {
  protocol.handle(ARTIFACT_PREVIEW_SCHEME, createArtifactPreviewHandler(readArtifact))
}
