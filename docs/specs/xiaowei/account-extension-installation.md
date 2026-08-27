---
sdd:
  id: feature.xiaowei.account-extension-installation
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-account-extension-installation-001
      text: Deployment-owned default plugins are active and immutable for every authenticated account, while optional plugin selections are isolated by account.
    - id: REQ-xiaowei-account-extension-installation-002
      text: Plugin installation requests derive the account from the authenticated principal, accept only a deployment-owned plugin id, and affect only sessions created after the selection changes.
    - id: REQ-xiaowei-account-extension-installation-003
      text: Each Session records the plugin selection used to compose its model-visible tools, and restoration or forks preserve that recorded selection instead of reading mutable account installation state.
    - id: REQ-xiaowei-account-extension-installation-004
      text: Conversational Skill installation derives ownership from the durable Session owner, requires one-shot user approval, writes only to that account's private Skill root, and becomes discoverable only to that account.
    - id: REQ-xiaowei-account-extension-installation-005
      text: The authenticated client distinguishes immutable defaults from optional plugins and reports that selection changes apply to new sessions.
    - id: REQ-xiaowei-account-extension-installation-006
      text: A valid account bearer remains the authenticated principal for ordinary loopback RPCs so desktop-created Sessions record the signed-in account owner, while bearer-free requests and host-machine management methods retain local identity.
  acceptance:
    - id: ACC-xiaowei-account-extension-installation-001
      text: An assembled Xiaowei runtime activates the safe default catalog entry for two accounts, rejects an unavailable host-execution plugin, and keeps account Skill installation isolated.
      evidence:
        - packages/account/plugin-factory/tests/plugin-factory.spec.ts
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-account-extension-installation-002
      text: New sessions record their resolved plugin ids, and restoration and fork checks use that record after account installation state changes.
      evidence:
        - packages/account/plugin-factory/tests/plugin-factory.spec.ts
        - packages/host/apiproxy/tests/api-proxy-account-plugins.spec.ts
        - packages/sdk/client/tests/sdk-client.spec.ts
        - python/sdk/tests/test_client.py
    - id: ACC-xiaowei-account-extension-installation-003
      text: Plugin RPC checks prove principal-derived ownership, system-default immutability, idempotency, and omission of activation ids, account ids, module names, and server paths from the wire response.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-account-plugins.spec.ts
    - id: ACC-xiaowei-account-extension-installation-004
      text: An assembled Xiaowei account installs an approved Skill and discovers it on the next lookup, while another account cannot discover it.
      evidence:
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-account-extension-installation-005
      text: Focused checks reject anonymous and subagent installation before approval, reject unavailable or disabled approval without writes, and refuse unsafe Skill filesystem targets.
      evidence:
        - packages/account/tool-skill-install/tests/tool-skill-install.spec.ts
        - packages/account/skill-store/tests/skill-store.spec.ts
        - packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts
    - id: ACC-xiaowei-account-extension-installation-006
      text: The authenticated settings page lists defaults and optional plugins, performs install and uninstall through the typed client API, and displays the new-session activation rule.
      evidence:
        - packages/client/ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx
        - packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
    - id: ACC-xiaowei-account-extension-installation-007
      text: The loopback carrier preserves a valid account bearer for an account RPC and keeps bearer-free requests and host-machine management methods on the local principal.
      evidence:
        - packages/client/connection/tests/node-half.host.spec.ts
  evidence:
    - packages/account/plugin-factory/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - packages/account/tool-skill-install/src/index.ts
    - packages/account/skill-store/src/index.ts
    - packages/client/ui-settings-plugin-inventory/src/client/PluginFactorySettingsTab.tsx
    - apps/cli/tests/web-agent-presets.e2e.ts
  decisions:
    - .agents/notes/implemented/architecture/2026-08-26-account-scoped-plugin-and-skill-installation.md
    - docs/architecture.md
---
# Xiaowei account extension installation

English | [中文](account-extension-installation.zh.md)

This feature gives each signed-in Xiaowei account isolated extension state while keeping deployment defaults available to everyone. It covers the plugin factory and conversational Skill installation as separate product paths with one server-derived ownership rule. Xiaowei's shipped catalog currently contains only the safe `core-tools` default; the generic optional-plugin mechanism remains available, but Xiaowei does not publish a host-execution activator before that capability has account isolation.

## Runtime rules

The deployment owns plugin code, catalog metadata, and activation functions. Account requests may select only a catalog `pluginId`; they cannot provide an account id, activation id, module name, configuration object, or server path. Default catalog entries remain active without account rows, while optional rows, when a deployment publishes them, are keyed by the authenticated account. Xiaowei's product catalog deliberately has no optional host-execution row today.

A Session records the resolved plugin ids used for its tool composition. Changes to account installation state affect later Sessions, not an existing Session after process restoration or fork.

The `skill_install` tool accepts Skill content but no ownership or path fields. The durable Session owner selects the account root, and the standard approval service must grant the individual write before the store publishes `SKILL.md` and refreshes discovery.

The desktop carrier preserves a valid account Bearer as the request principal for ordinary RPCs even when the Host is loopback. A loopback request without a valid Bearer remains the local management principal, and methods that act on the host machine preserve that local principal even when the desktop carries its account token. This distinction lets authenticated desktop Sessions record their account owner without removing local administration and native-host operations.

## Verification

Acceptance combines service tests, authenticated RPC tests, client component tests, Session replay checks, SDK event projection, and the shipped Xiaowei composition. Every acceptance ID above names evidence at its claimed layer.
