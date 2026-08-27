# @deepseek-ai/dsh-account-skill-store

English | [中文](README.zh.md)

Private filesystem store for Skills created through an authenticated account session. An owner id is hashed with SHA-256 and never used as a path segment directly; each Skill is written to `<dshHome>/accounts/<owner-hash>/skills/<name>/SKILL.md` with private directory and file modes.

Writes validate kebab-case names and bounded content, reject symlink targets, stage on the same filesystem, sync the file, and rename atomically. Repeating identical content is idempotent; replacing different content under the same name is a conflict.

## Model Experience

### Storage service

#### What the model sees

Nothing directly. A model can reach the store only through a consumer such as `@deepseek-ai/dsh-tool-skill-install`.

#### Token effect

None directly.

#### KV Cache effect

None directly; the Skill registry consumer decides when a changed catalog is projected.

## Known Limitations and Deferred Work

- The store creates Markdown-only Skill bundles and no `scripts`, `references`, or `assets` resources.
- There is no update or delete operation; conflicting content requires an explicit future lifecycle API.
