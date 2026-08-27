# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

Plugin settings for both local diagnostics and authenticated remote accounts. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. Local loopback mode keeps the read-only Loader inventory and lazily calls `ctx.remote.pluginInventory.list()`. Remote account mode calls `ctx.connection.api.accountPlugins`, renders the server-owned catalog, marks immutable system defaults, and lets the signed-in account install or uninstall optional entries by `pluginId`.

Remote mutations never carry an account id, module name, or path. The host derives ownership from the authenticated principal. The page states that selection changes apply only to newly created Sessions; existing, restored, and forked Sessions retain their recorded selection.

The tab renders a searchable two-column catalog of compact disclosure cards. Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id without a redundant field label, followed by the effective configuration and, for enabled entries, Cordis status. Disabled entries omit the redundant unmounted runtime state. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Two distinct data planes** — local mode remains a read-only Loader diagnostic; only authenticated remote mode exposes account catalog mutations.
- **No live session recomposition** — a successful remote mutation updates account state, while an already running agent keeps its existing tools.
