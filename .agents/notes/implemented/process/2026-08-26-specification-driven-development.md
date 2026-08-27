# Agent Note: Specification-driven development workflow

Status: implemented

English | [中文](2026-08-26-specification-driven-development.zh.md)

## Problem

Ops scenarios need one durable place to state requirements, acceptance, ownership, and evidence without duplicating the runtime integration contract or decision rationale.

## Decision

The repository uses SDD reference documents and three templates for platform features, reusable capabilities, and external integrations. Specifications are normalized before implementation, use globally unique requirement and acceptance IDs, and move from `draft` through `approved` to `implemented` or `retired`. An implemented specification lists repository-relative evidence for every acceptance ID.

The `next-best-action` Skill is the first implemented capability specification. Its evidence names the keyless ops template verifier and the assembled Skill loader test. Integration specifications record identity, credentials, and per-operation mode, risk, approval, idempotency, retry, compensation, and audit fields.

SDD owns what must be true. `docs/ops/scenario-integration-contract.md` owns Skill/Subagent runtime boundaries, and Agent Notes own rationale, rejected alternatives, and consequences. The SDD skill links these records rather than copying their content.

## Alternatives considered

**Only Agent Notes.** Agent Notes explain why a durable decision was made but do not provide stable per-requirement acceptance mapping, so they cannot serve as the implementation checklist.

**Only the ops scenario contract.** The scenario contract defines runtime integration rules, not arbitrary platform or capability requirements and evidence, so expanding it would make one document own unrelated scopes.

**A single universal template.** Feature, capability, and integration work have different ownership and control fields; separate templates make required integration controls explicit without weakening simpler specifications.

## Consequences

New non-trivial work carries a reviewable specification before implementation and a path-level evidence map before completion. The repository has a small amount of duplicated bilingual structure and must re-record translation sidecars after edits. Evidence paths prove the claimed repository layer only; deployment or production claims still require their own operational observations.
