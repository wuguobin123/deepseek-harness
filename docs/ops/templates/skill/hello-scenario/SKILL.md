---
name: hello-scenario
description: One-line summary the model reads in the catalog; <= ~120 chars.
whenToUse: Optional human-facing hint; not model-visible.
---

# Hello scenario

Replace this body with the directive the parent model should read when it
loads this Skill. The body is plain Markdown; the Skill consumer renders it
as `<skill_content>` and injects it at the user-explicit gesture boundary.

Keep the body short. The Skill body lives inside the parent's request
context, so every token here costs against the parent's context window.
Reference external files or tool calls instead of inlining large content.

## What the model does after reading this Skill

1. Decide whether the user's task matches the scenario.
2. If yes, follow the directives below; if no, say so and stop.
3. When the directives produce tool calls, the parent's approval chain governs them.

## Directives

- Replace this section with the scenario-specific steps the model should follow.
- Prefer numbered steps over prose paragraphs; the model parses lists reliably.
- When the scenario needs side effects, name the exact tool calls the model should make.

## Reference material

Drop references, templates, or scripts under a `references/` or `scripts/`
directory beside this `SKILL.md`. The Skill consumer renders the resource
base after the body and lists the available files for the model to read.
