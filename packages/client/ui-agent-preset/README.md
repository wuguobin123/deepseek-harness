# dsh-client-ui-agent-preset

English | [中文](README.zh.md)

The agent-preset UI consists of a General-settings row choosing which [preset](../../preset/agent-presets/README.md) later sessions use and a read-only label in the session header.

## Why it is a new-session preference

A session's preset is fixed when the session is created — the host refuses to adopt an existing session under a different one, because that session's history was produced under the first preset's tools. The General row changes the default for later sessions; running sessions keep the composition they began with.

## The new-session screen

The new-session screen renders no preset selector. Starting a session uses the effective default reported by the host, so preset choice remains a persistent setting instead of per-session hero state.

## The session-header label

Beside the session title, the client shows the preset this session runs as static chrome. A control there would promise a switch the host refuses outright. It reads the preset from the session's own summary and resolves the display name against the same roster the General row reads. Forwarded `agent-preset/selected` owner events fold committed blank-session switches into that shared summary in every tab; the initiating tab may already have applied the RPC echo, and the merge is idempotent.

## What it reads and writes

Options and the current default both come from one `agentPreset.list` call. The roster already reports which id a session with no explicit choice gets, so the row needs no settings-schema introspection; the write targets the `agent-presets` settings namespace's `default` field, which is what the host resolves at creation.

A locally authored preset is exactly as privileged as the plugins it names, so the list marks `user` rows rather than presenting every preset as shipped and vetted.

Preset files publish one unlocalized `name` and `description`, which Web uses for every `user` row and unknown `system` row. For the four shipped ids (`standard`, `code`, `minimal`, and `cordis`), Web resolves both fields from its active locale only when the roster marks the row `system`; an identically named `user` preset keeps its file metadata.

The row re-reads on `settings/changed` for its own namespace and on `connection/reset`: the roster is a live directory and the default is a settings field, so an external edit or a reconnect can both move it.

## When the surfaces are absent

A deployment that composes no presets answers with an empty roster, and the row and label render nothing. Every session then shares the host composition, so there is nothing to select or display.

## Model Experience

Indirectly, through the preset a later session is composed from; [`dsh-agent-presets`](../../preset/agent-presets/README.md) owns what that composition puts in front of the model.

#### KV Cache effect

No direct invalidation. Changing the default never touches a running session's prefix; a session created afterwards establishes its own prefix from its own composition.

## Known Limitations and Deferred Work

- **A preset without metadata is listed by id** — display text is optional, and a copy given no name deliberately falls back to its directory name rather than presenting itself identically to its source.
