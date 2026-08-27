# Specification-driven development

English | [中文](README.zh.md)

This reference defines specification-driven development (SDD) for the harness. A specification is the reviewable source for scope, ownership, acceptance, and evidence before implementation begins.

## Specification kinds

- **Platform** specifications define product-wide rules, shared runtime assumptions, and cross-capability invariants. Use the `feature` kind when the specification describes a user-visible platform feature.
- **Capability** specifications define one reusable service, provider, tool, or skill and its observable behavior. Use the `capability` kind when the capability can be implemented and verified independently.
- **Integration** specifications define how an external system, scenario, or package connects to an existing capability. Use the `integration` kind when identity, credentials, operations, or handoff rules are part of the work.

The schema uses `kind: feature` for platform specifications; “platform” is the responsibility level, while `feature`, `capability`, and `integration` are the machine-readable kinds.

## Responsibility layers

The specification owner states the user or operator outcome and stable requirements. The implementation owner chooses packages, interfaces, and tests that satisfy those requirements. The integration owner records external identities, credentials, operation risks, approval, retry, compensation, and audit obligations. The reviewer checks that acceptance IDs are observable and that evidence points to repository-relative artifacts. A release or operations owner confirms implemented evidence at the layer being claimed.

Do not use a specification to replace package READMEs, subsystem references, or source contracts. Link to those owners for detailed API semantics; link back to the specification for the decision's scope and acceptance.

## Lifecycle

`draft` is incomplete and open for refinement. `approved` is the implementation input: requirements, acceptance IDs, owners, and applicable integration controls are settled. `implemented` records shipped behavior and must list at least one repository-relative evidence path for every acceptance ID. `retired` is no longer an available contract and remains for traceability.

Before implementation, normalize the request into one specification kind, assign non-empty owners, give every requirement and acceptance a globally unique ID, and record decisions as links. During implementation, keep the specification and tests aligned. Before completion, resolve every acceptance item to evidence and remove unresolved or future-tense claims from an `implemented` specification.

## Machine-enforced rules

`pnpm run verify-sdd` validates every English specification under `docs/specs/` and runs in `doc-sync` and the static CI gate. It accepts only `feature`, `capability`, and `integration` kinds and the `draft`, `approved`, `implemented`, and `retired` lifecycle. It rejects duplicate IDs, missing owners or text, repository-escaping or missing evidence paths, and an `implemented` acceptance without evidence.

Every integration operation declares mode, risk, approval, idempotency, retry, compensation, and audit policy. A read is R1 with no approval. A write is R2 or R3 with per-call approval, a real idempotency rule, and compensation for R2. Record whether evidence uses a simulated provider or the real external system; neither one proves the other.

## Evidence levels

Evidence is ordered from narrowest to strongest: a static or unit check proves a local rule; an assembled package or integration test proves composition; a runnable smoke proves the configured path; an operator or production observation proves the deployed surface. A stronger claim may cite several levels, but a weaker artifact must not be presented as proof of a higher layer. Paths in `evidence` are repository-relative and are reviewed as links to the exact check, fixture, or implementation.

The `next-best-action` capability is the reference pilot. Its acceptance evidence includes [the ops template verifier](../ops/templates/verify.py) and the assembled Skill test [packages/ops/ops-skill/tests/loader-composition.spec.ts](../../packages/ops/ops-skill/tests/loader-composition.spec.ts).

## Relationship to existing records

SDD owns the work item’s requirements and acceptance mapping. The ops scenario integration contract at `docs/ops/scenario-integration-contract.md` owns the runtime boundary between Skills and Subagents, naming, manifests, lifecycle, and permissions. An integration specification cites that contract instead of copying it.

An [Agent Note](../../.agents/notes/README.md) records why a durable repository decision was made, the alternatives that lost, and its consequences. The specification records what must be true; the Agent Note records why the chosen design is worth keeping. Non-trivial SDD decisions add or update an implemented process note when the workflow itself changes.

## Templates and authoring rule

Start with [feature-spec](templates/feature-spec.md), [capability-spec](templates/capability-spec.md), or [integration-spec](templates/integration-spec.md). Keep the English and Chinese frontmatter byte-identical, mirror the document structure, and maintain each sidecar with `verify-translation-pairing --write`. Normalize first, implement second, and close every acceptance item before declaring `implemented`.
