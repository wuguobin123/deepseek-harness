# Agent Note: Ops Skill frontmatter closing boundary

Status: implemented

English | [中文](2026-08-26-ops-skill-frontmatter-closing-boundary.zh.md)

## Problem

The ops Skill loader found the closing frontmatter delimiter but returned the wrong line-start field, so YAML metadata was parsed as empty and bundled Skills could not be validated as declared.

## Decision

The loader records the closing delimiter's actual line start before slicing the frontmatter block. The assembled loader test covers discovery, metadata loading, and disposal for the bundled `next-best-action` Skill, while the keyless verifier covers the manifest and body.

## Verification

The focused `packages/ops/ops-skill/tests/loader-composition.spec.ts` test passes, and `python3 docs/ops/templates/verify.py` validates the bundled Skill without a model call or network access.

## Alternatives considered

**Relax metadata validation.** Ignoring empty metadata would hide the parser defect and allow malformed Skills to load, so the boundary is corrected at the loader.

**Patch only the fixture.** Changing expected metadata would preserve incorrect runtime behavior and was rejected.

## Consequences

Bundled Skill metadata is available to the assembled loader and remains covered at both manifest-smoke and loader-test levels. The fix is local to frontmatter parsing; runtime Skill behavior remains read-only.
