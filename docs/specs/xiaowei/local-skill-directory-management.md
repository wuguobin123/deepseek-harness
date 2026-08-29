---
sdd:
  id: feature.xiaowei.local-skill-directory-management
  kind: feature
  status: implemented
  owners:
    - xiaowei-desktop
  requirements:
    - id: REQ-xiaowei-local-skill-directory-management-001
      text: The desktop installs a selected local Skill directory, including its nested regular files, below the formal desktop user-data runtime without uploading the directory or exposing either filesystem path to the renderer.
    - id: REQ-xiaowei-local-skill-directory-management-002
      text: Installation validates the root SKILL.md, rejects links and special files, applies bounded file-count and byte limits, and commits a complete bundle atomically without replacing different existing content.
    - id: REQ-xiaowei-local-skill-directory-management-003
      text: Desktop Settings shows a searchable inventory of locally installed Skill bundles, including invalid entries, independently of the Skills active in a particular Session.
    - id: REQ-xiaowei-local-skill-directory-management-004
      text: A valid installed Skill remains available after desktop restart and can be invoked through the existing slash-command contract.
    - id: REQ-xiaowei-local-skill-directory-management-005
      text: One user-explicit /<skill-name> gesture contributes at most one durable skill-invocation message to the admitted step, including when overlapping runtime scopes mount the Skill consumer.
  acceptance:
    - id: ACC-xiaowei-local-skill-directory-management-001
      text: A nested Skill fixture installs with byte-identical resources, restrictive destination permissions, and an inventory record; repeating the same install is idempotent while different existing content is rejected.
      evidence:
        - apps/desktop/tests/local-skill-directory.test.ts
    - id: ACC-xiaowei-local-skill-directory-management-002
      text: Directory traversal, symbolic links, special files, missing or invalid SKILL.md metadata, and configured count or byte limit violations leave no installed or staging bundle.
      evidence:
        - apps/desktop/tests/local-skill-directory.test.ts
    - id: ACC-xiaowei-local-skill-directory-management-003
      text: The Electron IPC and preload surface opens the native directory picker, keeps source and destination paths in the main process, and returns only browser-safe inventory and result fields.
      evidence:
        - apps/desktop/tests/ipc-handlers.test.ts
        - apps/desktop/src/preload/index.ts
    - id: ACC-xiaowei-local-skill-directory-management-004
      text: The desktop Skill Settings section can search, refresh, and install bundles while displaying valid and invalid local inventory states and the slash command for valid Skills.
      evidence:
        - apps/desktop/tests/skill-management.test.tsx
        - apps/desktop/src/renderer/features/skill-management/SkillManagementSection.tsx
    - id: ACC-xiaowei-local-skill-directory-management-005
      text: The complete frontend-slides directory is present below the formal installed client's runtime home and is discovered after a fresh installed-client start.
      evidence:
        - docs/ops/xiaowei-local-skill-directory-management-acceptance.md
    - id: ACC-xiaowei-local-skill-directory-management-006
      text: Unit and assembled Xiaowei local-profile tests mount overlapping Skill consumers and prove that one explicit gesture yields one skill-invocation instruction message.
      evidence:
        - packages/skill/tool-skill/tests/tool-skill.spec.ts
        - apps/cli/tests/xiaowei-local.snapshot.ts
  evidence:
    - apps/desktop/src/main/local-skill-directory.ts
    - apps/desktop/src/main/ipc-handlers.ts
    - apps/desktop/src/renderer/features/skill-management/index.ts
  decisions:
    - .agents/notes/implemented/feature/2026-08-27-xiaowei-local-skill-directory-management.md
---
# Xiaowei local Skill directory management

English | [中文](local-skill-directory-management.zh.md)

## Outcome

Xiaowei Desktop installs complete local Skill bundles instead of reducing them to one `SKILL.md` file. The installed bundle stays on the device, survives restart, and appears in a dedicated Settings inventory before any Session chooses whether to load or invoke it.

## Requirements

### REQ-xiaowei-local-skill-directory-management-001

The native main process owns directory selection and copying. It derives the destination from the formal Electron `userData` directory, never accepts an arbitrary destination, never sends a source or destination path to the renderer, and never uploads bundle content.

### REQ-xiaowei-local-skill-directory-management-002

The installer accepts one directory whose root contains a valid `SKILL.md`. It copies nested regular files except repository metadata, rejects links and special files, enforces fixed safety limits, stages on the destination filesystem, and atomically renames the complete verified tree. Identical existing content is a successful no-op; different existing content is a conflict. This version does not overwrite or uninstall a bundle.

### REQ-xiaowei-local-skill-directory-management-003

Settings lists the formal local runtime's installed bundle directories, not a Session's resolved Skill catalog. Each browser-safe row reports the Skill name, description, file count, total bytes, validity, and a concise error when invalid. It does not disclose filesystem paths.

### REQ-xiaowei-local-skill-directory-management-004

The existing local Skill filesystem provider discovers committed bundles. A user invokes a valid bundle with `/<skill-name>` under the existing slash-command behavior; installation does not introduce a second execution protocol.

### REQ-xiaowei-local-skill-directory-management-005

User-explicit invocation is idempotent within one admitted step. If overlapping runtime scopes mount more than one Skill consumer, downstream listeners may satisfy the gesture first; later listeners recognize the matching proposed `skill-invocation` message and do not append another durable instruction message.

## Acceptance

### ACC-xiaowei-local-skill-directory-management-001

Focused store tests install a multi-level fixture, compare resource bytes and modes, inspect the inventory, repeat the install, and exercise a conflicting destination.

### ACC-xiaowei-local-skill-directory-management-002

Focused store tests exercise every rejected filesystem or metadata condition and verify that neither the final bundle nor a staging directory remains.

### ACC-xiaowei-local-skill-directory-management-003

IPC and preload tests prove that renderer calls carry no filesystem path and that cancellation and browser-safe result fields cross the bridge.

### ACC-xiaowei-local-skill-directory-management-004

Renderer tests mount the Settings section, filter inventory rows, refresh them, and complete a native directory installation.

### ACC-xiaowei-local-skill-directory-management-005

Installed-client acceptance checks the formal runtime home, restarts the installed application, and reads the effective local Skill catalog. Source tests or a portable package do not satisfy this acceptance item.

### ACC-xiaowei-local-skill-directory-management-006

A focused consumer test and the assembled Xiaowei local-profile snapshot mount overlapping Skill consumers, submit one explicit Skill gesture, and assert that the admitted step contains exactly one matching `skill-invocation` message.

## Decisions

The local-only storage, native-picker trust boundary, atomic conflict behavior, and separation between installed inventory and effective Session catalog are recorded in the [local Skill directory management Agent Note](../../../.agents/notes/implemented/feature/2026-08-27-xiaowei-local-skill-directory-management.md).
