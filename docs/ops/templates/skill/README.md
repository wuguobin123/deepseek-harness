# Skill Scenario Template

English | [中文](README.zh.md)

Copy this directory next to your profile's `cordis.yml`, rename `hello-scenario/` to your scenario's kebab-case name, and edit `SKILL.md`. The provider `dsh-skill-filesystem` discovers the directory and registers the Skill on `ctx.skills` once `customSkillDirs` points at it.

## Files

- `SKILL.md` — the Skill itself. Frontmatter carries `name` and `description`; the body is the model-facing content.
- `cordis.patch.yml` — patch overlay that wires the directory into the filesystem Skill provider.

## Naming

`hello-scenario` is a placeholder. Rename the directory to your scenario's kebab-case name (no leading digits, no dots, no underscores) and update the frontmatter `name:` to match. The provider rejects mismatches with a warning and drops the Skill from the catalog.

## Mounting

The template's `cordis.patch.yml` mounts `dsh-skill-filesystem` with `includeDefaultRoots: false` and `customSkillDirs` pointing at the directory that contains this Skill. Apply the patch with:

```sh
pnpm dsh --profile headless --patch docs/ops/templates/skill/cordis.patch.yml "..."
```

The Skill then appears in the model-facing catalog through `dsh-tool-skill` and in the user-facing command palette when `user-invocable` is left at the default `true`.

## Verifying

Boot the patched profile and ask the model to load the Skill by name. The provider re-reads `SKILL.md` on every invocation, so frontmatter and body edits take effect without restarting the harness.

## Boundaries

A Skill ships prompt content only. Side effects ride on the surrounding model turn. The Skill does not declare risk or approval; the parent approval chain governs whatever tool calls follow the Skill body in the same turn.

For scenarios that need their own session, their own tool set, or a final assistant text the parent reads once, use the [Subagent template](../subagent/README.md) instead.

See the [Scenario Integration Contract](../../scenario-integration-contract.md) for the boundary rules between Skill and Subagent, the manifest fields, and the lifecycle obligations.
