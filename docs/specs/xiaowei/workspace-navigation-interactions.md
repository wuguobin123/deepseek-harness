---
sdd:
  id: feature.xiaowei.workspace-navigation-interactions
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-workspace-navigation-interactions-001
      text: Grouped workspace navigation always exposes independently collapsible local and cloud sections, including a section with no current workspaces.
    - id: REQ-xiaowei-workspace-navigation-interactions-002
      text: Each location section offers an add action that opens the existing directory flow for that location without changing local-directory or cloud-copy semantics.
    - id: REQ-xiaowei-workspace-navigation-interactions-003
      text: The top workspace header remains a labelled navigation region with search, view options, and a global add menu.
  acceptance:
    - id: ACC-xiaowei-workspace-navigation-interactions-001
      text: Local and cloud disclosure controls hide only their own workspace rows, persist their choices in the browser view store, and expose accessible expanded state.
      evidence:
        - packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
        - packages/client/ui-workspace/tests/tree.client.spec.ts
    - id: ACC-xiaowei-workspace-navigation-interactions-002
      text: Local and cloud add controls open the composed directory flow directly with the matching location and no intermediate menu, while the top add control retains the complete choice menu.
      evidence:
        - packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
        - packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx
    - id: ACC-xiaowei-workspace-navigation-interactions-003
      text: The workspace header and location controls retain compact dimensions, visible interaction feedback, and keyboard focus indicators.
      evidence:
        - packages/client/ui-workspace/tests/browser-styles.client.spec.ts
  evidence:
    - packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx
    - packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css
    - packages/client/ui-workspace/src/client/WorkspacePicker.tsx
  decisions:
    - .agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md
---
# Xiaowei workspace navigation interactions

English | [中文](workspace-navigation-interactions.zh.md)

The workspace browser separates device-backed local workspaces from account-private cloud workspaces without changing either execution model. Both location headers remain visible, remember whether their rows are expanded, and keep their add action available while the configured directory flow can serve it.

## Interaction rules

Selecting a location title changes only that section's row visibility. Selecting its add control passes the location to the existing directory flow: local opens the live-folder operation, while cloud opens the independent-copy operation. The top Workspace header remains the complete navigation entry for search, view choices, and users who want the global add menu.

## Verification

Component checks drive both disclosure states and both direct add paths through the composed flow owner fields. Store and CSS checks pin persistence, accessible state, compact dimensions, hover feedback, and keyboard focus. These checks prove the shared client package; an installed Xiaowei client requires separate observation.
