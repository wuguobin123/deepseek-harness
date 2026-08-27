# Agent Note: Xiaowei account session isolation

Status: implemented

English | [中文](2026-08-24-xiaowei-account-session-isolation.zh.md)

## Problem

Xiaowei authenticated HTTP requests only retained the boolean fact that a bearer token was valid. The account `userId` was discarded before API Proxy dispatch, while Session headers and both persistence backends had no owner field. Session listing, history, mutations, exports, and live event streams therefore operated on one process-wide collection, so signing in as another account exposed the previous account's conversations.

The desktop shell also treated every signed-in state as the same connection generation. Switching directly from account A to account B could leave A's mux and host downlinks alive while B's token was installed.

## Decision

Bearer authentication now produces an account principal containing `userId`, and the transport carries it through unary HTTP, response delivery, downloads, and both WebSocket downlinks. API Proxy stamps newly created Sessions with that identity as `ownerId` and authorizes every Session-addressed read or mutation before loading an Agent or returning data. Listing and search filter both attached and cold Sessions; exports, subagent and goal operations, pending interactions, jobs, and live Session frames apply the same owner rule. A foreign Session is indistinguishable from an absent one at the API surface.

`ownerId` is a branded, optional Session header field. JSONL records it in the header, SQLite schema 18 records it in `sessions.owner_id`, and forks inherit it. Local in-process callers remain unscoped for non-account single-user compositions. Account requests cannot see or claim an unowned Session.

The desktop connection key includes the authenticated `userId`. An account change aborts and awaits both old downlinks before it installs the next token and creates a new connection generation.

## Persistence compatibility

Adding `ownerId` changes the Session header format, so `SESSION_FORMAT_VERSION` is 1. The repository is pre-release and supplies no v0-to-v1 or SQLite 17-to-18 migration. Existing v0 JSONL roots and schema-17 databases are rejected explicitly; deployment must start with a fresh Session store or perform a separately reviewed owner assignment migration. Automatic first-login claiming is forbidden because it would assign shared historical conversations to whichever account arrived first.

## Verification

Focused Session, JSONL, SQLite, API Proxy, connection, and desktop tests cover owner persistence, account A/B list and access isolation, principal propagation, event-stream authentication, and token-switch teardown. The keyless snapshot suite replays current v1 Session fixtures. Focused TypeScript programs compile the Session, persistence, API Proxy, and connection packages.

## Alternatives considered

- **Filter only in the renderer** — rejected because direct HTTP, downloads, WebSocket frames, and mutation methods would still expose or modify foreign Sessions.
- **Prefix Session ids with the account id** — rejected because Session ids are opaque durable identifiers and callers can submit a preallocated id; ownership must be checked independently of naming.
- **Claim every unowned Session for the first authenticated account** — rejected because the current shared store cannot prove which historical account created a Session.

## Consequences

Account-scoped deployments gain server-enforced Session isolation across stored and live data. Non-account local compositions preserve their existing behavior. Upgrading a deployment with old Session data requires an explicit data decision before restart; account identity, tokens, and wallet data use separate stores and are not rewritten by this Session format change.
