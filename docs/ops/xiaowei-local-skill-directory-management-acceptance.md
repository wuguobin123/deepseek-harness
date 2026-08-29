# Local Skill directory management acceptance

English | [中文](xiaowei-local-skill-directory-management-acceptance.zh.md)

Date: 2026-08-27

## Source gates

The desktop package passed `pnpm --filter @deepseek-harness/desktop typecheck`, its complete Vitest suite with 23 files and 123 tests, ESLint with no errors, and the production `build:main` plus `build:renderer` path. The existing `es2024` target and bundle-size warnings remained warnings.

The focused tests cover complete nested-directory installation, `.git` exclusion, private modes, owner execution, identical-content idempotence, conflicting-content rejection, links, invalid metadata, file-size limits, staging cleanup, browser-safe inventory, native-picker-only IPC, cancellation, search, refresh, and installation from the Settings section.

## Formal desktop data

The complete directory selected for this acceptance was installed through `LocalSkillDirectoryManager` below the formal macOS desktop data root at `~/Library/Application Support/@deepseek-harness/desktop/local-runtime/skills/frontend-slides`. The target did not exist before installation.

The installer returned `status: installed`, `fileCount: 163`, and `totalBytes: 3532176`. A recursive content comparison against the source, excluding `.git`, reported no differences. The destination contained no links, special files, `.git`, staging directory, or install lock. Its root directories were mode `0700`; `SKILL.md` was `0600`; source executable scripts were `0700`.

## Installed-runtime discovery

The probe started `/Applications/小薇.app` version 0.3.27's bundled `xiaowei-device-runtime.mjs` with the formal desktop data root, created blank Session `session-536877c1-f76b-4f74-8c84-578857471d56`, and called `skill.list` through the packaged HTTP RPC path. The response included `frontend-slides` with its complete description and `modelInvocable: true`.

This proves formal data installation and packaged-runtime discovery. The new Settings inventory is source-built and tested but is not present in the already installed 0.3.27 application; it becomes installed-client behavior only after a later desktop package and release are explicitly authorized.
