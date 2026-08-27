# Agent Note: Account workspace and execution isolation

Status: implemented

English | [中文](2026-08-26-account-workspace-and-execution-isolation.zh.md)

## Problem

Session ownership prevented one account from reading another account's conversation, but a Workspace identified only a host path. An authenticated account could submit a path or Workspace id that selected host-readable files, and local filesystem reads were permitted by every sandbox mode. Same-host shell and workflow execution therefore made account isolation depend on caller-selected paths instead of an execution environment owned by that account.

## Decision

Every Workspace carries a durable owner: one authenticated account or the local management identity. Workspace registry reads and mutations accept an access identity, account RPCs derive it only from the authenticated principal, and unknown and foreign workspace ids produce the same not-found response. Workspace domain version 3 requires the owner field. The registry validates Session cwd and Session owner before attaching an id and preserves those checks for cold persisted Sessions.

The API gateway derives each account root below deployment storage by hashing the authenticated user id. Account Session creation rejects caller-provided `cwd`, creates or selects a Workspace below that root, and validates directory browsing and creation after canonical path and symlink resolution. Account responses stop home and breadcrumb projection at the private root, reject native directory picking and host path opening, and scope Workspace events and archived Session ids by durable owner. Local calls retain the existing host-facing path operations.

Xiaowei configures one account preset explicitly. The gateway requires that configured preset and roster before it creates an account Session, ignores no missing roster, filters the account roster to that preset, and prevents account preset selection or authoring. The preset includes document, spreadsheet, presentation, chart, HTML artifact, Skill, web search, goal, plan, question, and todo capabilities. It excludes same-host shell, raw filesystem, workflow, job, and delegated execution tools. Xiaowei's plugin catalog likewise publishes only the safe system default until optional activators execute inside an account-confined runtime.

This change uses a pre-release format cut. The first Xiaowei release carrying Workspace owners backs up and clears historical Session and Workspace media before startup instead of migrating it. The runtime rejects old Workspace media and never assigns an ambiguous path or conversation to the first account that sees it.

## Verification

Workspace tests cover durable owner validation, owner-scoped lookup and ordering, attach-time Session owner checks, cold Session projection, domain version rejection, and the cache/table invariant. API tests cover two account roots, foreign Workspace ids, caller-provided cwd, directory escape attempts, host capability denial, scoped event delivery, and account preset enforcement. Client tests prove Workspace connection sends only the Workspace id. The assembled Xiaowei test proves the account-safe tool roster, unavailable host-execution plugin rejection, and account-private Skill installation.

## Alternatives considered

**Authorize only at the Session API.** A caller could still select another host directory before the Session received its owner, so Session ownership alone did not protect files.

**Keep host tools and rely on `workspace-write`.** The policy permits every read and is not a process or kernel isolation mechanism. It cannot prevent disclosure through shell commands, workflow workers, or filesystem tools.

**Migrate or assign historical records.** Historical Workspaces may mix Sessions or paths without an unambiguous account owner. This pre-release deployment has no compatibility promise, so backup and clearing is safer than inventing authority.

## Consequences

Authenticated users keep the basic exploration and office-artifact capabilities that operate through owner-aware services, but do not receive local coding, shell, workflow, or delegation capabilities. Restoring those capabilities requires an execution provider whose filesystem, subprocess, spill, terminal, workflow, and child-agent resources all inherit the same account root and owner. Release acceptance must separately prove the backup, historical-media clearing, installed-client behavior, and production deployment.
