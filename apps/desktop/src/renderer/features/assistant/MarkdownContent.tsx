/**
 * Markdown renderer used in the Assistant view.
 *
 * http(s) links open in the system browser via `window.open` with
 * `noopener,noreferrer`; everything else (mailto:, javascript:, scheme-less
 * paths) renders as plain text. The Electron security policy denies the
 * renderer from reaching `shell.openExternal` directly, so the in-app
 * webview stays on its CSP-restricted origin.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function safeMarkdownUri(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function MarkdownContent({
  children,
  className = '',
}: {
  children: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`assistant-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ children: linkChildren, href }) {
            const safeUri = safeMarkdownUri(href)
            return safeUri ? (
              <a href={safeUri} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            ) : (
              <span>{linkChildren}</span>
            )
          },
          table({ children: tableChildren }) {
            return (
              <div className="assistant-markdown__table">
                <table>{tableChildren}</table>
              </div>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
