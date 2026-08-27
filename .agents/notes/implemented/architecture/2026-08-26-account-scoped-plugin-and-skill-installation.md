# Agent Note: Account-scoped plugin and Skill installation

Status: implemented

English | [中文](2026-08-26-account-scoped-plugin-and-skill-installation.zh.md)

## Problem

OpenAI packages a plugin as shared installable code containing Skills, MCP servers, and optional UI. Installation and enablement select that package for an account or workspace instead of copying executable code into each chat. Workspace availability, plugin inclusion, connector authorization, action permissions, and runtime permissions remain distinct controls. Skills also retain distinct system, administrator, user, and repository roots, and plugin installation does not grant a connector access token. These separations are documented in [Plugins](https://developers.openai.com/plugins/concepts/plugins), [Plugin controls](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors), and [Skills](https://learn.chatgpt.com/docs/enterprise/skills).

The WorkBuddy composition mounted a fixed Cordis plugin set and projected Loader entries through a read-only inventory. Its account security carried the authenticated principal into a branded Session owner, inherited that owner on forks and subagents, filtered Session operations by owner on the server, and stopped old streams before a client account switch. This provided account and Session isolation but did not define account-specific plugin installation state.

Xiaowei combines the useful parts of both models: shared deployment-owned plugin code, explicit account installation records, server-side Session ownership, account-private Skill storage, and separate user approval for persistent conversational installation.

## Decision

Xiaowei exposes two installation mechanisms with one ownership rule: the authenticated principal selects the account, and no browser or model payload may supply an account id or server path. The plugin factory stores optional selections by `(user_id, plugin_id)` and resolves `pluginId` through a server-owned catalog of pre-registered activators. Conversational Skill installation derives the owner from the durable Session header and writes only below that owner's hashed account directory.

For ordinary RPCs, the carrier resolves a valid account Bearer before assigning loopback's local-management principal. A signed-in Electron client therefore keeps its account principal when it creates a Session on loopback and writes that account into the new Session header. A bearer-free loopback request remains local management. Methods that act on the host machine also preserve the local principal when an account token is present, so native actions and administrative tooling do not need to impersonate an account.

System-default plugins remain deployment composition and are projected as installed, immutable catalog entries without per-account rows. A new account Session snapshots its optional plugin ids in the required `account-plugins/selected` log event, including an empty array. The same snapshot composes the new Agent. Installation changes affect only Sessions created afterward; cold restoration and ordinary forks compose from the recorded event rather than mutable account state. A legacy Session without the event receives only current system defaults. Delegated child agents inherit their preset composition; optional activators mounted on the parent's exact scope do not propagate to the child.

## Plugin factory

`account.plugins.list`, `account.plugins.install`, and `account.plugins.uninstall` derive `userId` from `request.principal`. Their wire values omit activation ids and storage details. SQLite retains only account and plugin ids plus installation time. Unknown ids fail; system defaults cannot be uninstalled; repeated install and uninstall operations are idempotent.

An installable catalog row names a server-registered activator rather than a module path. For new Sessions the host reads account selection once and uses the same ordered plugin-id array for the Session event and activation. For restoration and forks, `mountAccountPlugins()` resolves activators from Session events before agent publication. Unknown or invalid durable ids fail restoration instead of silently changing the tool set. Activator effects land in the exact Agent scope, so clients cannot submit executable configuration and one account's optional tools cannot enter the global registry layer.

## Skill installation

`skill_install` accepts `name`, `description`, and `instructions`. Sessions without an owner and subagents are denied before prompting. Every eligible proposed call enters the standard one-shot approval service before dispatch; rejection, unavailable approval, and the `never` policy fail closed without writing. The store hashes the owner id with SHA-256 and writes `<dshHome>/accounts/<hash>/skills/<name>/SKILL.md` using private permissions, bounded input, symlink refusal, same-filesystem staging, file synchronization, and atomic rename. Identical content is idempotent; different content under the same name conflicts.

Account-aware Skill lookup includes only configured system roots, the bundled root, and the matching account root. It excludes project and shared user roots. `ownerId` participates in the registry cache key, and successful installation calls `ctx.skills.refresh()` so the next lookup sees the new Skill. The model result exposes only `{ name, changed }`.

## Client behavior

The existing settings tab has two modes. Loopback retains the read-only Loader diagnostic. Authenticated remote mode renders the account catalog, marks system defaults, and offers install or uninstall actions for optional rows. The page states the new-session activation rule.

## Verification

Focused generic plugin-factory tests cover account-row isolation, system-default activation and immutability, unknown catalog configuration, per-Agent tool scoping, Session selection snapshots, fork preservation after uninstall, principal-derived RPC ownership, loopback bearer preservation, wire redaction, account-directory separation, atomic and idempotent Skill writes, symlink refusal, approval grant and rejection, anonymous and subagent denial, immediate registry refresh, account-aware filesystem discovery, and both settings modes. The assembled Xiaowei check proves that the product catalog publishes only the `core-tools` default, rejects the unavailable host-execution `precise-editor` id, and completes `skill_install` through the real approval mux before checking two account views.

Desktop release acceptance requires all four platform packages before publication. The server and COS receive versioned objects first, stable aliases second, and `latest.json` last, so every URL named by an observed manifest already resolves.

## Alternatives considered

**Copy plugin code into each account directory.** This would duplicate deployment-owned executable code, complicate upgrades, and make integrity depend on per-account files. Shared catalog code plus account selection rows keeps versioning and activation under deployment control.

**Let clients or models provide account ids and installation paths.** This would turn ownership isolation into caller discipline. The authenticated principal and durable Session owner remain the only account selectors, while the server derives every storage path.

**Treat default and optional plugins as the same mutable installation record.** This would let an account remove deployment-required behavior. Defaults stay immutable composition, while only optional catalog entries create account records.

**Recompose an existing Session from current account state.** Its history was produced with the recorded tool set, so changing it during live use, restoration, or fork would weaken replay consistency. Optional installation changes take effect only for Sessions created afterward.

## Consequences

Adding a marketplace entry requires deployment code to register its activator and public catalog metadata. Xiaowei currently publishes no optional catalog entry; the generic account-selection lifecycle remains implemented for a future safety-reviewed activator. Existing shared local Skills are not automatically assigned to a remote account; they must be installed into that account explicitly. Live plugin recomposition and Skill update/delete operations remain separate future lifecycle work.

Workspace-role availability, signed marketplace package and version distribution, connector OAuth grants, per-action authorization, and installation audit history remain separate lifecycle layers. Adding them must not merge executable package distribution, account selection, external-service credentials, or runtime permission decisions into one record.
