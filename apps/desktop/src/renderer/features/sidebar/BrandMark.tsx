/**
 * Brand mark — sidebar variant.
 *
 * Re-implements webUI's `<BrandMark>` occupant of
 * `sidebar.brand`. Identical rendering to `Brand` but mounted inside
 * the sidebar rail at the top, above the workspace selector.
 */

export function BrandMark(): React.JSX.Element {
  return (
    <span className="sidebar__brand brand brand-official" data-testid="sidebar-brand" aria-label="小薇">
      <span className="brand__logo" aria-hidden="true">小薇</span>
    </span>
  )
}
