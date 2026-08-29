# Agent Note: Xiaowei local Skill directory management

Status: implemented

English | [中文](2026-08-27-xiaowei-local-skill-directory-management.zh.md)

## Problem

The desktop's model-visible `skill_install` tool writes only `SKILL.md`. A Skill that depends on scripts, templates, examples, or other nested resources therefore appears installed but cannot perform its complete workflow. The desktop also has no persistent inventory that lets a user see what exists in the formal local runtime independently of the active Session catalog.

## Decision

Xiaowei Desktop provides a native directory importer and a visible Settings inventory. The main process opens the operating-system directory picker and keeps both source and destination paths outside the renderer. It installs below the fixed formal `userData/local-runtime/skills` root and does not upload local content.

The importer validates a root `SKILL.md` with the standard YAML parser, copies bounded nested regular files while excluding repository metadata, rejects links and special files, and uses a destination-filesystem staging directory followed by atomic rename. A digest over relative names, owner-execution state, and bytes makes an identical reinstall idempotent. Different content at an existing Skill name returns a conflict rather than overwriting user data.

The Settings inventory scans installed directories rather than reusing `skill.list`, because `skill.list` is a resolved per-Session execution catalog. Browser-safe rows contain descriptive metadata and validation state but no filesystem paths. A valid Skill continues to use the existing `/<skill-name>` invocation contract.

User-explicit invocation is idempotent within one admitted step. When overlapping runtime scopes mount more than one `tool-skill` consumer, a listener recognizes a matching `skill-invocation` message already proposed by a downstream listener and does not append another. The Session log therefore records one instruction message per Skill name and step.

This version installs directories and lists them. It does not accept ZIP or URL sources and does not overwrite or uninstall a bundle.

## Alternatives considered

**Keep the single-file installer as the only path.** Rejected because it silently discards resource files required by real Skills such as frontend-slides.

**Send a selected source path through generic renderer RPC.** Rejected because renderer compromise could substitute an arbitrary readable path. The native picker and copy operation remain in the privileged main process.

**Upload the directory to the account service.** Rejected because local Workspace execution and installed Skills are device-owned; cloud copying requires a distinct, explicit account-scoped operation.

**Overwrite or delete from the first management screen.** Rejected because those actions can destroy user-maintained resources. Conflict reporting is sufficient for initial installation and listing.

**Require every assembled runtime to mount exactly one Skill consumer.** Rejected because host and Agent scope layering is configuration-dependent. The consumer must preserve invocation semantics when valid compositions overlap.

## Consequences

Focused store, IPC, preload, renderer, build, and installed-runtime evidence is linked from the implemented [feature specification](../../../../docs/specs/xiaowei/local-skill-directory-management.md). Installing the complete frontend-slides directory preserves its 163 regular files in the formal desktop runtime. The installed runtime discovers it through `skill.list`, and explicit invocation contributes one durable instruction message even when the local profile mounts overlapping consumers.

Recursive copying still faces filesystem state that may change during installation. The importer rejects links before file reads, uses no-follow file handles, bounds the work, verifies staged output, serializes same-name commits, and cleans incomplete staging directories. Inventory intentionally does not prove that a Skill is active in a Session, so the UI states that distinction. ZIP and URL imports, replacement, and deletion remain unavailable.
