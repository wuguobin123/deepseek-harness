# @deepseek-ai/dsh-ops-skill

English | [中文](README.zh.md)

Bundled Skill provider for the ops product group. Scans [`./skills/`](./skills/) at boot, registers every `<name>/SKILL.md` entry on `ctx.skills` under the `ops-skill` provider name, and serves the body on demand. Scenarios enter one at a time by dropping a directory under `skills/` that satisfies the [scenario contract](../../../docs/ops/scenario-integration-contract.md).

## Plugin

Function plugin. Requires `ctx.skills`.

## Layout

```
ops-skill/
  src/index.ts            # provider factory
  skills/
    <scenario-name>/
      SKILL.md            # frontmatter + body, re-read on every load
      references/         # optional resource directory
      scripts/            # optional scripts the model may invoke
```

Each scenario directory ships as one Skill bundle. The provider scans one level deep only — `**/SKILL.md` discovery is deliberately excluded, matching the upstream `dsh-skill-filesystem` provider's surface.

## Adding a scenario

1. Copy [`docs/ops/templates/skill/`](../../../docs/ops/templates/skill/README.md) into `skills/<scenario-name>/`.
2. Edit `SKILL.md` frontmatter (`name`, `description`) and the body.
3. Re-mount the plugin or wait for the next `ctx.skills.snapshot()`; the provider re-reads on every `skill(name)` call.

See the [scenario integration contract](../../../docs/ops/scenario-integration-contract.md) for the field schema, the Skill vs Subagent boundary, and the permission model.

## Config

Empty. The provider has no configurable surface; rank is `BUNDLED_SKILL_RANK` (`600`).

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-skill`, which renders this provider's catalog and selected instruction body.

#### KV Cache effect

Body-only edits leave the catalog digest unchanged; frontmatter edits invalidate the provider at the registry level and trigger a replacement catalog the next time the consumer renders.

## Known Limitations and Deferred Work

- **No watch** — the bundled provider scans at boot; for hot reload use [`@deepseek-ai/dsh-skill-filesystem`](../../skill/skill-filesystem/README.md) pointed at this directory.
- **Bundled only** — runtime and remote Skills use the runtime registration path documented in the scenario contract.
- **One directory deep** — nested skill trees are not discovered.
