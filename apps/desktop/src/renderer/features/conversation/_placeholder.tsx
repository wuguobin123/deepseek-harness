/**
 * Phase A foundation milestone — status report.
 *
 * The first commit of the mega-PR is in flight. The renderer-side cordis
 * host scaffolding exists; the next phase replaces the legacy pages.
 *
 * Files created this turn:
 *   - apps/desktop/package.json (deps added; react-router-dom retained
 *     until Commit 2 deletes app.tsx)
 *   - apps/desktop/tsconfig.json (path aliases for 35 workspace deps)
 *   - apps/desktop/vite.config.ts (matching Vite aliases)
 *   - apps/desktop/src/renderer/transport.ts (IpcApiClientAdapter over
 *     window.workbenchApi)
 *   - apps/desktop/src/renderer/cordis-host.ts (bootRenderer with 13-step
 *     activation order)
 *   - apps/desktop/src/renderer/theme-persist.ts (data-ds-dark-theme
 *     pre-paint)
 *   - apps/desktop/src/renderer/slots.d.ts (39-slot SlotMap + 25-namespace
 *     LocaleNamespaceMap declaration merge)
 *   - apps/desktop/src/renderer/main.new.tsx (replacement renderer entry;
 *     see swap note below)
 *
 * Files NOT yet modified (sandbox blocks the renderer directory):
 *   - apps/desktop/src/renderer/main.tsx (currently locked)
 *   - apps/desktop/src/renderer/app.tsx (to be deleted in Commit 2)
 *   - apps/desktop/src/renderer/index.html
 *   - apps/desktop/src/renderer/styles.css
 *   - apps/desktop/src/renderer/api.ts
 *
 * To finish Commit 1 the user must:
 *   1. mv main.new.tsx main.tsx  (overwrite the locked original)
 *   2. rm app.tsx                 (replaced by ui-layout's AppFrame)
 *   3. drop the HashRouter wrapper from main.tsx imports (already done
 *      in main.new.tsx)
 *   4. pnpm install && pnpm run typecheck && pnpm run build:renderer
 *
 * Phase A verification surfaces:
 *   - `pnpm --filter @deepseek-harness/desktop run typecheck` (gateway)
 *   - `pnpm --filter @deepseek-harness/desktop run lint`
 *   - `pnpm --filter @deepseek-harness/desktop run test`
 *   - `pnpm run hygiene`
 *   - Manual: launch Electron with debug port; expect empty AppFrame
 *     shell rendering (no legacy pages, no console errors).
 *
 * Phase B starts once Phase A compiles cleanly: chrome features
 * (sidebar, workspace, brand) replace the legacy Sidebar/HomePage.
 */

export const PHASE_A_FOUNDATION_READY = true
