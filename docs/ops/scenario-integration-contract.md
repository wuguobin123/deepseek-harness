# Scenario Integration Contract

English | [中文](scenario-integration-contract.zh.md)

How new business scenarios enter the ops product on the dsh harness. This contract is the single home for the boundary between Skill and Subagent接入, naming rules, manifest schemas, registration flow, lifecycle, and permission mapping. Each scenario ships exactly one scenario kind; mixing kinds hides its lifecycle and confuses disposal.

## Scope

- **In scope** — the contract for adding a scenario under `packages/ops/` or any consumer profile.
- **Out of scope** — runtime semantics inside a scenario (those live with the package implementing it). Built-in scenarios ship with `ops-skill` and `ops-runtime` when those packages land; this contract governs every future addition.

## Pattern selection

A scenario is one of two patterns. Choose the pattern first, then write the manifest.

| Pattern | Owns | Calls | Session | Approval | Typical example |
|---|---|---|---|---|---|
| **Skill** | prompt snippet + body resources, no runtime | model-facing tool consumes it on demand | none (model reads it in-band) | inherits the surrounding turn's approval | `oa_workbench`, `frontend_slides`, `next_best_action` |
| **Subagent** | dedicated agent preset + own session + own tool set | produces a final assistant text or stop-reason | one session per start (`session_id` minted) | its own delegated approval | `route_work`, `capability_runner`, `evidence_validator` |

Use Skill when:

- the work is one prompt-shaped directive the parent model should read inline.
- the artifact is body text or static resources (Markdown, templates, small scripts).
- no fresh conversation state is required.

Use Subagent when:

- the work needs its own multi-turn loop, distinct tools, or persona.
- the result is a complete answer the parent reads once, not inline guidance.
- a fresh session keeps the parent's KV cache prefix stable.
- recursion needs the depth budget the seam owns.

When both fit, prefer Skill — a Skill cannot accidentally nest into another agent's depth budget and has no subprocess or session lifecycle to maintain.

## Naming

- Skill name: kebab-case, no leading digits, dot-free; mirrors the `name` field in the Skill frontmatter.
- Subagent preset id: kebab-case, prefix `ops.<scenario>` for ops product scenarios; the runtime prefix becomes the `providerName` argument on `ctx.subagents.start(...)`.
- Capability id (the string passed to the model in tool schemas): one of `<skill-name>` or `<ops.subagent-id>`; never collides across kinds.
- Subagent provider names registered on `ctx.subagents` are reserved: `spawn`, `fork`, `acp`, `claude-code`, `codex`, `dsh-sdk`, `ops-python`. New scenarios pick a different name; the runtime refuses duplicate registrations.

## Skill manifest

A Skill lives on disk and ships with the provider that exposes it (`dsh-skill-filesystem` for local roots, a custom provider for embedded ones). The provider parses each entry's frontmatter and body and registers it on `ctx.skills`. The Skill's own files stay the single source of truth; this contract documents the fields and lifecycle, not the on-disk shape.

| Field | Required | Type | Meaning |
|---|---|---|---|
| `name` | yes | kebab-case string | registry name; rejected if it collides with another Skill in the same provider layer |
| `description` | yes | string | model-facing summary; capped by the loader consumer |
| `whenToUse` | no | string | additional human hint; not model-visible |
| `metadata` | no | open object | free-form provider or consumer payload |
| `disable-model-invocation` | no | boolean | excludes the Skill from the model-facing catalog when true |
| `user-invocable` | no | boolean | excludes the Skill from the human-facing command palette when false |
| `body` | yes | Markdown | model reads on `skill(name)` invocation |

Discovery rules live in the Skill provider; this contract fixes only the columns above. Invocation policy fails closed — a rejected camel-case spelling or non-boolean invocation value drops the entire Skill with a warning.

Skills do not carry an approval manifest. The risk of reading a Skill body is the risk of the surrounding model call; the parent's approval chain governs side effects produced afterward.

## Subagent manifest

A Subagent scenario is a dsh agent preset plus a subagent provider that starts the preset on demand. The contract holds for both in-process and out-of-process backends (`subagent-spawn-in-process`, `subagent-fork-in-process`, `subagent-acp`, `subagent-dsh-sdk`, `subagent-claude-code`, `subagent-codex`, `ops-subagent-python`).

### Required fields

| Field | Type | Meaning |
|---|---|---|
| `id` | kebab-case string with `ops.` prefix for ops product scenarios | preset id and the `<id>` argument passed to `ctx.subagents.start(...)` |
| `preset` | agent preset reference | the `cordis.yml` entry that mounts the agent's tool set, persona, system prompt, and lifecycle |
| `provider` | registered `ctx.subagents` provider name | the backend that fulfills `start` for this scenario |

### Optional fields

| Field | Default | Meaning |
|---|---|---|
| `outputSchema` | absent | when present, `ctx.subagents.start(...)` validates the final assistant output against it; the parent declares `maxDepth: 'provider-managed'` only when the child owns recursion itself |
| `toolFilter` | inherit parent | the tool set visible to the child; absent inherits the parent's registered tools minus those the child preset excludes |
| `persona` | none | replaces the global persona for the child session only |
| `risk` | `R1` | risk level for `interaction/user-approval` (see Permissions) |
| `validForSeconds` | 0 | how long an approval granted for this scenario stays valid for repeat invocations of the same `arguments_hash`; 0 means per-call approval only |
| `executionVersion` | preset sha | approval-binding version; the approval chain rejects a grant against a stale version |
| `tags` | `[]` | free-form labels used by the capability registry and dashboards |

### Example

```yaml
- id: ops-capability-runner
  name: '@deepseek-ai/dsh-ops-capability-runner'
  config:
    providerName: ops-python
    risk: R2
    validForSeconds: 600
    executionVersion: 1
    tags: [orchestrator]
```

## Registration flow

A scenario joins a profile through one of three entry points. The rule is one scenario per entry point; mixing duplicates the lifecycle and breaks disposal.

### 1. Skill from a local root

Mount `dsh-skill-filesystem` (or extend it with `customSkillDirs`) so the provider scans a directory the scenario ships in. The Skill needs no `cordis.patch.yml` row of its own; the directory layout and frontmatter are the registration.

### 2. Skill as a runtime registration

When the scenario must ship inside a plugin, call `ctx.skills.register({ name, description, body, invocation: { modelInvocable, userInvocable }, provider: 'runtime' })` from the plugin's effect. Runtime registrations use rank `250`: project Skill providers override them, while they override the local-root provider's custom and user rows.

### 3. Subagent through a preset

A Subagent scenario mounts its agent preset and provider in the same `cordis.yml` patch row group. Two rows are typical:

```yaml
- id: ops-capability-runner-preset
  name: '@deepseek-ai/dsh-ops-capability-runner-preset'

- id: ops-subagent-python
  name: '@deepseek-ai/dsh-ops-subagent-python'
  config:
    providerName: ops-python
```

For an in-process Subagent that needs no provider row, mount only the preset row and reference `provider: spawn` in the parent caller.

For an ACP- or SDK-driven Subagent, add the corresponding `subagent-acp` / `subagent-dsh-sdk` row beside the preset row. The preset row stays scoped to the agent composition; the provider row stays scoped to the wire.

## Lifecycle

Skill and Subagent have different owners. The disposer belongs to the registry that produced the entry; nothing else tears it down.

| Aspect | Skill | Subagent |
|---|---|---|
| Owner | the Skill provider that registered it | the caller of `ctx.subagents.start(...)`, through the returned run |
| Disposal trigger | provider unload, layer teardown, file-system invalidation for filesystem roots | `run.dispose()` (one-shot) or the continuation manager (continuable) |
| In-flight invocations | discarded; a parent that already called `skill(name)` keeps the loaded body in the request history | rejected at the seam boundary with a known stop reason |
| Disposal during a turn | no-op; the Skill body is already in tool history | `aborted` stop reason; partial output remains visible |
| Re-registration after disposal | the provider re-discovers on the next `snapshot()` | a new `start(...)` mints a new run id and a new child session |

A plugin that registers a Skill in its effect **must** return the disposer; a leak survives provider reloads and re-publishes the Skill under stale metadata. The Skill registry exposes the exact Cordis disposer for this reason.

A Subagent caller that drops the run without calling `dispose()` leaks one child session per dropped reference. The seam enforces depth caps but not reference accounting; the caller is responsible.

## Permissions

Risk and approval are the seam that binds a scenario to the parent approval chain. The contract fixes one risk taxonomy shared by Skill and Subagent; the parent approval surface reads it from the scenario's risk fields and the registered approval policy.

| Level | Meaning | Default approval |
|---|---|---|
| `R1` | read-only; the scenario inspects data and returns text | none |
| `R2` | reversible side effect (DB write, send chat message, queue a job) | first invocation requires approval; subsequent invocations within `validForSeconds` reuse the grant |
| `R3` | irreversible or externally visible side effect (money movement, public post, key issuance) | per-call approval; `validForSeconds` is ignored |

The approval chain compares `approval.executionVersion` to the scenario's current `executionVersion` and `approval.argumentsHash` to the JSON-canonicalized request hash; either mismatch forces a re-approval. Reused approvals expire when `validForSeconds` elapses or the scenario's risk level rises.

Skills carry no risk field — they are pure prompt content. Their effects ride on the surrounding model turn; the parent's approval chain governs the side effects the parent takes afterward.

The loop guard on the parent turn applies regardless of pattern: a Skill repeatedly loaded with the same arguments or a Subagent repeatedly started against the same arguments falls under the five-class detection in `guard/repeat-tool-reminder` (exact repeat, ping-pong, fatigue, research stagnation, unknown capability repeat). The detection runs in the parent's `tools/pre-execute` waterfall so it sees every pattern uniformly.

## Templates

The drop-in scaffolds live beside this contract and verify both接入 shapes keylessly:

- [`templates/skill/`](templates/skill/README.md) — `hello-scenario/SKILL.md` + `cordis.patch.yml` for `dsh-skill-filesystem`.
- [`templates/subagent/`](templates/subagent/README.md) — `hello_subagent.py` + `cordis.patch.yml` for `dsh-ops-subagent-python`.
- [`templates/verify.py`](templates/verify.py) — keyless smoke that exchanges JSON-RPC with the Python peer and parses the Skill frontmatter; run from the repo root with `python3 docs/ops/templates/verify.py`.

## Cross-references

- Skill registry contract: [`@deepseek-ai/dsh-skill`](../../packages/skill/skill/README.md).
- Local Skill provider: [`@deepseek-ai/dsh-skill-filesystem`](../../packages/skill/skill-filesystem/README.md).
- Subagent seam contract: [`@deepseek-ai/dsh-subagent`](../../packages/subagent/subagent/README.md).
- Python Subagent provider: [`@deepseek-ai/dsh-ops-subagent-python`](../../packages/ops/ops-subagent-python/README.md).
- User approval extension point: [`@deepseek-ai/dsh-interaction-user-approval`](../../packages/interaction/user-approval/README.md).
- Loop hygiene: [`@deepseek-ai/dsh-guard-repeat-tool-reminder`](../../packages/guard/repeat-tool-reminder/README.md).
- Plan and roadmap: [`hashed-cooking-quill.md`](../../.claude/plans/hashed-cooking-quill.md) Phase 0 P0.6-P0.9.
