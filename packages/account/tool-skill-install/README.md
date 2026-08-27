# @deepseek-ai/dsh-tool-skill-install

English | [中文](README.zh.md)

Model-facing `skill_install` consumer for conversational Skill installation. Its arguments are only `name`, `description`, and `instructions`; ownership comes exclusively from `exec.agent.session.header.ownerId`. Anonymous sessions and subagents are denied before prompting. Every eligible call enters the standard one-shot approval seam before dispatch; a rejection, missing approval channel, or disabled approval policy fails closed without writing. After a grant, the tool writes through `ctx.accountSkillStore`, then refreshes `ctx.skills` before returning `{ name, changed }`. No account id or server path is exposed to the model.

## Model Experience

### Conversational installation

#### What the model sees

The model proposes one edit-intent `skill_install` call with `name`, `description`, and `instructions`. The user sees the exact call and grants or rejects that one installation. A successful result says whether the named Skill was installed or already present, without revealing the account or server path.

#### Token effect

The fixed tool schema appears wherever the consumer is mounted; each call adds one short retained tool result.

#### KV Cache effect

The tool schema is fixed. A successful install can cause the Skill catalog consumer to append a later catalog replacement.

## Known Limitations and Deferred Work

- The tool creates only new Skills; it does not overwrite or delete existing content.
- Subagents cannot install Skills because delegated work must not mutate the account's persistent capability set.
- The deployment must compose an approval answerer for interactive installation; unattended and unavailable channels deny the call.
