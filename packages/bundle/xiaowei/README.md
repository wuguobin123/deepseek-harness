# `@deepseek-ai/dsh-xiaowei`

English | [中文](README.zh.md)

The Xiaowei multi-user profile bundle layers authenticated account services, owner-scoped workspace roots, wallet and model-key storage, artifacts, search providers, and the remote desktop carrier over the shared base composition. Account roots derive from `XIAOWEI_ACCOUNT_WORKSPACE_ROOT` (or `DSH_HOME/account-workspaces`) and a SHA-256 account id; same-host shell, raw filesystem, workflow, and delegated execution tools remain disabled.

The Xiaowei-safe agent composition mounts the `skill_install` tool when the account skill store is present. A successful conversational installation writes one `SKILL.md` under an opaque account-hash directory and refreshes the skill registry for the next lookup. The client never chooses a server module, activation id, filesystem path, configuration body, or account id; all ownership comes from the authenticated principal and the session header created for that principal.

The same composition exposes `web_search` and `web_fetch` independently of the Session's conversation model. Search uses Firecrawl with loopback SearXNG as its missing-credential fallback. Fetch uses the DNS-pinned public HTTP provider first and tries Firecrawl only after a safely retrieved HTTP 403 or 429 response; a Firecrawl credential is therefore optional for ordinary public pages and raw files.

The `tool-capabilities` export is the machine-readable manifest for the shipped local and cloud presets. It names shared tools, location-only tools, and permitted location-aware descriptions. The assembled profile test reads the registered definitions and compares each shared input and output schema, timeout, presentation callbacks, and concurrency classification; it rejects an undeclared difference. A location-aware description may differ only when the manifest declares it, so the model can see whether persistent data belongs to the computer or the account.

## Model Experience

### Installed account capabilities

#### What the model sees

The bundle contributes no model-visible text directly. Its preset exposes stable web tool schemas whose host-selected providers do not change with the conversation model. Mounted plugin activators may add tools to newly created account Sessions; restoration and forks preserve the selection recorded by that Session. `skill_install` exposes a tool schema that lets the model persist a user-approved skill. Installed skill content enters a later model request only when the skill lookup and invocation path selects it.

#### Token effect

Data-dependent on the installed plugin tools and on any account Skill selected for a later request; the bundle contributes no prompt tokens by itself.

#### KV Cache effect

Plugin selections can change the tool-schema prefix of later agent instances. Installing a skill does not rewrite an active request; later skill selection may add the stored instructions to that request's context.

## Known Limitations and Deferred Work

- Plugin selections do not hot-recompose an already running Agent; create a new session or cold-restore the session to apply them.
- The plugin catalog and activators are deployment code, not a remote marketplace feed.
- Xiaowei currently publishes only its deployment-safe `core-tools` catalog entry. The generic optional-plugin mechanism remains available to other deployments, but Xiaowei does not publish a host-execution activator until account isolation for that capability is available.
- Account skills are local to one Xiaowei host. Replication, version history, review workflow, and cross-device synchronization are not implemented.
- Delegated child agents currently inherit the preset composition, not optional activators attached to the parent Agent's exact scope.
