/**
 * Brand mark.
 *
 * Re-implements webUI's `<BrandMark>` occupant of
 * `conversation.hero.brand.mark`. Static — no props, no state.
 */

export function Brand(): React.JSX.Element {
  return (
    <span className="brand brand-official" data-testid="brand-mark" aria-label="小薇">
      <span className="brand__logo" aria-hidden="true">小薇</span>
      <span className="brand__wordmark">小薇</span>
    </span>
  )
}
