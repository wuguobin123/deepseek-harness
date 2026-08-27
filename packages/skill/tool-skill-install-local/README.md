# @deepseek-ai/dsh-tool-skill-install-local

English | [中文](README.zh.md)

Model-facing `skill_install` consumer for conversational installation in the desktop-supervised local runtime. Its arguments are only `name`, `description`, and `instructions`; the destination comes exclusively from the launcher's configured Harness home. Subagents are denied before prompting. Every eligible call enters the standard one-shot approval seam before dispatch; rejection, an unavailable approval channel, or the `never` policy fails closed without writing.

After approval, the tool validates the Skill name and encoded size, refuses symbolic-link and conflicting destinations, publishes `$DSH_HOME/skills/<name>/SKILL.md` through an atomic directory rename, and refreshes `ctx.skills` before returning `{ name, changed }`. The model never receives the local filesystem path.

## Model Experience

### Conversational installation

#### What the model sees

The model proposes one edit-intent `skill_install` call. The user approves or rejects that exact installation. A successful result says whether the Skill was installed or already present; later Skill discovery sees a newly installed Skill without restarting the local Host.

#### Token effect

The fixed tool schema appears wherever this consumer is mounted; each call adds one short retained tool result.

#### KV Cache effect

The tool schema is fixed. A successful install can cause the Skill catalog consumer to append a later catalog replacement.

## Known Limitations and Deferred Work

- The tool creates only new Skills; it does not overwrite or delete existing content.
- It accepts inline Markdown instructions, not a URL or an untrusted archive fetched from the network.
- Subagents cannot install Skills because delegated work must not mutate the computer's persistent capability set.
