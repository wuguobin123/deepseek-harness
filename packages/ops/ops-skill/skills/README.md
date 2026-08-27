# ops-skill/skills

English | [中文](README.zh.md)

Bundled Skill directories for the ops product group. Each subdirectory is one scenario; see [`../README.md`](../README.md) and the [scenario integration contract](../../../../docs/ops/scenario-integration-contract.md) for the entry schema.

## Scenarios

| Scenario | Risk | Status | Source |
|---|---|---|---|
| `next-best-action` | R1 (read-only) | migrated | my-agents `skills/next_best_action` |

## Adding a scenario

Copy [`docs/ops/templates/skill/`](../../../../docs/ops/templates/skill/README.md) into a new directory here, edit the frontmatter and body, and add a row above. The bundled Skill provider picks the entry up at boot.
