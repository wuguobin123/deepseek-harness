# @deepseek-ai/dsh-account-plugin-factory

English | [中文](README.zh.md)

Server-owned plugin catalog and per-account installation state. Catalog rows map a public `pluginId` to a pre-registered activator; clients can never submit a module name, filesystem path, or configuration body. SQLite stores only optional installations keyed by `(user_id, plugin_id)`. System-default rows are always enabled and cannot be removed.

For a new Session, the host reads the authenticated account's optional selection once, records it as `account-plugins/selected`, and passes the same snapshot to `mountAccountPlugins()`. Cold restoration and forks mount from that Session event instead of rereading mutable account state. A legacy Session without the event receives only current system defaults. The bundled catalog includes the system-default base capability row and the optional precise editor.

## Model Experience

### Activated capabilities

#### What the model sees

Installed activators may add model-facing tools such as `str_replace_editor` to that account's later agent scopes. The factory itself adds no prompt text or tool schema.

#### Token effect

Data-dependent on the installed activators; the factory contributes no tokens by itself.

#### KV Cache effect

Changing an installation can change tool schemas for later agent instances and therefore their cache prefix. It does not mutate a running instance.

## Known Limitations and Deferred Work

- The catalog and activators are deployment code, not a remote marketplace feed.
- Installation changes take effect only for Sessions created afterward; existing, restored, and forked Sessions retain their recorded selection.
- Delegated child agents inherit their preset composition, not optional activators attached to the parent agent's exact scope.
- The SQLite row records the selected plugin id; catalog-version migration policy is not implemented.
