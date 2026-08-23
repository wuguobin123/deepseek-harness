import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { workbenchApi } from '../../api';

function safeMarkdownUri(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function openMarkdownExternalLink(
  event: { preventDefault: () => void },
  uri: string,
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }> =
    workbenchApi.openExternalUrl
): void {
  // Renderer-side navigation and window.open are deliberately denied by the
  // Electron security policy. Route approved http(s) links through the
  // preload/main-process bridge instead, where shell.openExternal is guarded.
  event.preventDefault();
  void openExternalUrl(uri).catch(() => undefined);
}

export function MarkdownContent({
  children,
  className = ''
}: {
  children: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={`assistant-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ children: linkChildren, href }) {
            const safeUri = safeMarkdownUri(href);
            return safeUri ? (
              <a
                href={safeUri}
                onClick={(event) => openMarkdownExternalLink(event, safeUri)}
              >
                {linkChildren}
              </a>
            ) : (
              <span>{linkChildren}</span>
            );
          },
          table({ children: tableChildren }) {
            return (
              <div className="assistant-markdown__table">
                <table>{tableChildren}</table>
              </div>
            );
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
