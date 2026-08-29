---
sdd:
  id: feature.xiaowei.desktop-authentication-gate
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-desktop-authentication-gate-001
      text: The desktop restores the durable account state before mounting any local or cloud workspace interface.
    - id: REQ-xiaowei-desktop-authentication-gate-002
      text: A signed-out desktop shows a standalone account page and exposes no workspace, Session, settings, or signed-out local-workspace shortcut.
    - id: REQ-xiaowei-desktop-authentication-gate-003
      text: Sign-in mounts a fresh workbench for that account, while sign-out or an account change disposes the previous workbench before the next account surface becomes usable.
  acceptance:
    - id: ACC-xiaowei-desktop-authentication-gate-001
      text: A signed-out cold start renders the standalone sign-in gate without booting the Cordis workbench; sign-in boots it, and sign-out disposes it and restores the gate.
      evidence:
        - apps/desktop/tests/renderer-entry.test.ts
    - id: ACC-xiaowei-desktop-authentication-gate-002
      text: Signed-out account components contain no control or wording that allows local-workspace access without authentication.
      evidence:
        - apps/desktop/tests/cloud-signin-gate.test.tsx
        - apps/desktop/tests/signin-card.test.tsx
  evidence:
    - apps/desktop/src/renderer/main.new.tsx
    - apps/desktop/src/renderer/features/auth/SignInCard.tsx
    - apps/desktop/src/renderer/features/account/AccountSection.tsx
  decisions:
    - .agents/notes/implemented/architecture/2026-08-24-xiaowei-desktop-auth-gate.md
---
# Xiaowei desktop authentication gate

English | [中文](desktop-authentication-gate.zh.md)

The desktop account state controls access to the complete workbench. It is not only a cloud credential: the renderer does not mount local workspaces, cloud workspaces, Sessions, navigation, or Settings until durable authentication restoration reports a signed-in account.

## Runtime rules

Cold start first attaches the authentication broadcast listener and then reads the persisted account state. A signed-out result mounts only the standalone account page. A signed-in result mounts a fresh Cordis workbench for that account. Account changes are keyed by user id so one account never inherits another account's mounted client context.

Sign-out updates the shared authentication store, disposes the current Cordis host, and remounts the standalone account page. Embedded account components do not offer a return-to-local shortcut. A stale asynchronous workbench boot is disposed when its account key no longer matches the current authentication state.

## Verification

The renderer-entry test drives signed-out cold start, sign-in, and sign-out through the real Zustand subscription while replacing the Cordis host with a deterministic mount. Component checks pin the absence of signed-out local-workspace shortcuts. These checks prove source renderer behavior; an installed Electron client and a published release require separate acceptance.
