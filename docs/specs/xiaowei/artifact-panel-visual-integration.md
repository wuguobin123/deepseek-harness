---
sdd:
  id: feature.xiaowei.artifact-panel-visual-integration
  kind: feature
  status: implemented
  owners:
    - xiaowei-desktop
  requirements:
    - id: REQ-xiaowei-artifact-panel-visual-integration-001
      text: The artifact viewer uses the shared client theme tokens and presents one continuous details surface without repeating the outer panel title or border.
    - id: REQ-xiaowei-artifact-panel-visual-integration-002
      text: The active artifact identity, browser handoff, full-screen preview, download, and refresh remain available in a narrow details column without a text-heavy toolbar.
    - id: REQ-xiaowei-artifact-panel-visual-integration-003
      text: The artifact list, selected item, transient status, and preview canvas have distinct visual hierarchy in both light and dark themes.
    - id: REQ-xiaowei-artifact-panel-visual-integration-004
      text: A self-contained HTML artifact preserves a desktop-width layout in the narrow details column by fitting an isolated preview viewport to the available canvas, while full-screen preview uses the available native width and the no-network sandbox policy remains unchanged.
    - id: REQ-xiaowei-artifact-panel-visual-integration-005
      text: The packaged desktop loads active HTML artifacts from an independently served, re-authorized preview document whose CSP permits self-contained scripts while denying network access, without weakening the renderer CSP.
  acceptance:
    - id: ACC-xiaowei-artifact-panel-visual-integration-001
      text: A focused component check proves that artifact mode owns an edge-to-edge details body while ordinary tool details retain their padded scrolling body.
      evidence:
        - packages/client/ui-conversation/tests/gate-branch-tails.client.spec.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-002
      text: A focused desktop check proves the compact labeled controls, selected-item semantics, artifact count, and existing preview actions.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-003
      text: The desktop styles use shared client theme aliases for the panel, list, status, preview, and transcript artifact cards.
      evidence:
        - apps/desktop/src/renderer/styles.css
        - packages/client/ui-conversation/src/client/skeleton/DetailsPanel.module.css
    - id: ACC-xiaowei-artifact-panel-visual-integration-004
      text: A focused desktop check proves that a narrow HTML canvas receives a desktop-width iframe viewport scaled to fit, a wide canvas remains unscaled, and the sandbox continues to deny network access.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
        - apps/desktop/src/renderer/features/document-preview/DocumentPreview.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-005
      text: Focused desktop checks prove that the packaged renderer uses the artifact preview protocol, each request re-authorizes and validates an HTML artifact, malformed or non-HTML requests fail closed, and the response is non-cacheable with the no-network artifact CSP.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
        - apps/desktop/src/main/artifact-preview-protocol.ts
        - apps/desktop/src/main/index.ts
  evidence:
    - apps/desktop/src/renderer/features/document-preview/DocumentPreviewPanel.tsx
    - packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx
  decisions:
    - .agents/notes/implemented/feature/2026-08-24-xiaowei-artifact-registry.md
---
# Xiaowei artifact panel visual integration

English | [中文](artifact-panel-visual-integration.zh.md)

The artifact viewer belongs to the existing conversation details column. The details header names the surface once, and the viewer fills the body without adding a second panel frame.

## Presentation rules

The selected artifact summary and icon-only actions form one compact toolbar. Every action keeps a visible tooltip and an accessible label. The list shows its item count, uses a restrained selected state, and separates navigation from the preview canvas without introducing a dark nested surface.

All colors, borders, hover states, and status surfaces use the shared `--dsw-*` aliases. The same component therefore follows the active light or dark theme instead of carrying a desktop-only color scheme.

## HTML preview geometry

The details column may be narrower than the layout assumed by a generated dashboard. The HTML viewer therefore treats 960 CSS pixels as the minimum isolated page viewport and scales that iframe to the available preview canvas. The scaled iframe receives a proportionally larger viewport height, so its own scrolling and pointer interaction remain available without cropping the page. Once the canvas is at least 960 pixels wide, including frame-wide preview, the iframe uses the native available dimensions without scaling.

This fit changes only preview geometry. The existing sandbox and injected no-network content security policy remain in force, so fitting a page never grants remote resource access or parent-document privileges.

## HTML preview isolation

The packaged desktop loads HTML through `xiaowei-artifact://preview/<artifact-id>`. The main process re-runs the authorized artifact read, verifies the returned id, media type, byte count, and base64 bytes, and returns an independent HTML response with no caching and the restrictive artifact CSP. This separate response allows the artifact's self-contained inline chart or slide runtime to execute without inheriting the renderer's stricter `script-src 'self'` policy. The renderer CSP grants only frame navigation to this scheme; its own script policy is unchanged. Browser development uses the existing sandboxed `srcDoc` fallback.

## Verification

Focused client and desktop component checks cover the details-body ownership, labels, selection semantics, count, actions, preview geometry, and protocol failure behavior. The desktop renderer build validates the integrated styles, CSP declarations, and component imports.
