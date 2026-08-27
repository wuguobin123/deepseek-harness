/**
 * Security policy applied to generated HTML before it reaches a browser.
 * The artifact may run its own inline scripts, but it cannot fetch remote
 * resources, submit forms, embed frames, or navigate the preview surface.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
].join('; ')

/**
 * Insert the artifact CSP before any author content can execute.
 * @param source - generated HTML artifact text.
 * @returns HTML with a restrictive CSP meta element in the document head.
 */
export function withArtifactCsp(source: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
  if (/<head\b[^>]*>/i.test(source)) {
    return source.replace(/<head\b[^>]*>/i, tag => `${tag}${meta}`)
  }
  return `<!doctype html><html><head>${meta}</head><body>${source}</body></html>`
}
