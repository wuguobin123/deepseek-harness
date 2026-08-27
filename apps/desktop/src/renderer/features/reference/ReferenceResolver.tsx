/**
 * Reference resolver — preview pane for `@file` mentions.
 *
 * Re-implements webUI's `<ReferenceResolver>` occupant of
 * `conversation.input.overlay`. When a reference is selected from the
 * input-trigger menu, the host returns a `ReferencePreview` (snippet +
 * line range); this pane shows the snippet with the line range
 * highlighted.
 */

export interface ReferencePreview {
  refId: string
  path: string
  range?: { start: number; end: number }
  snippet: string
  language?: string
}

export interface ReferenceResolverProps {
  preview: ReferencePreview
  onClose: () => void
}

export function ReferenceResolver({ preview, onClose }: ReferenceResolverProps): React.JSX.Element {
  return (
    <section className="reference-resolver" data-testid="reference-resolver" data-ref-id={preview.refId}>
      <header className="reference-resolver__header">
        <h3 className="reference-resolver__title">{preview.path}</h3>
        {preview.range ? (
          <span className="reference-resolver__range">
            L{preview.range.start}–L{preview.range.end}
          </span>
        ) : null}
        <button type="button" className="reference-resolver__close" data-testid="reference-resolver-close" onClick={onClose}>
          ×
        </button>
      </header>
      <pre className={`reference-resolver__snippet language-${preview.language ?? 'plain'}`}>
        {preview.snippet}
      </pre>
    </section>
  )
}
