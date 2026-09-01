# Agent Note: Independent business Gateway

Status: implemented

English | [中文](2026-09-01-independent-business-gateway.zh.md)

## Problem

The declarative business Skill runtime hot-loads account-owned operation manifests, but the first Xiaowei metrics endpoint and its user grants ran inside the Xiaowei Host. A new database query or grant therefore changed Host code or boot configuration, which coupled ordinary business evolution to agent-service replacement even though the model-facing tool and Connector protocol were stable.

## Decision

Business authorization and data access run in a loopback-only Gateway behind the existing internal TLS hostname. Xiaowei continues to derive the user from the authenticated Session, resolve its deployment-owned service credential, and call one approved HTTPS Connector. nginx alone selects the Gateway upstream, so cutover and rollback do not replace Xiaowei.

The Gateway atomically hot-loads deployment-owned configuration containing operation ids, paths, registered provider/action names, permissions, and subject-hashed grants. The Skill manifest separately owns the model-facing JSON schemas. Neither configuration contains executable code, SQL, arbitrary headers, credential values, `userId`, or `tenantId`. The initial provider maps registered identity aggregate actions to fixed parameterized queries over a read-only database handle. New providers or action implementations require a Gateway deployment but never a Xiaowei deployment.

Each request pins one validated configuration snapshot, authenticates the service bearer in constant time, rejects tenant identity, validates the Host-derived user, verifies the exact operation permission and dynamic grant, executes the registered action, bounds its response, and durably audits the outcome before disclosure. Invalid configuration retains the last-good snapshot.

## Alternatives considered

**Continue adding routes to the Xiaowei webserver.** This kept the first implementation small but required a Xiaowei restart for every new query or grant source, contradicting the independent business lifecycle.

**Allow SQL or executable code in the Skill manifest.** This would make model-adjacent account configuration a database execution channel and let a publisher bypass provider review, identity derivation, and response limits.

**Give the Gateway the Xiaowei login token.** The token has the wrong audience and grants reusable account authority. The Gateway instead authenticates the service connection and authorizes the separately supplied trusted user.

## Verification

Nine focused tests over real temporary HTTP and SQLite instances prove registered action selection, reserved configuration rejection, safe owner scope, path and database-root confinement, service and user authorization, request-input rejection, same-process hot replacement, last-good retention, secret-free owner-only audit, and audit fail-closed behavior. Production served the two migrated metrics, hot-added `share-code-unused`, published business Skill revision 3, and completed an installed-client question through `business_skill_call`. Xiaowei's PID and start time remained unchanged, and the Gateway PID remained unchanged across its configuration update. The detailed evidence is in [the production acceptance record](../../../../docs/ops/xiaowei-business-gateway-acceptance.md).

## Consequences

Ordinary registered read actions and grants can now change without a Xiaowei source change or restart. The Gateway is a separate availability dependency, so nginx retains the old upstream as an explicit rollback target and systemd supervises the new process. The closed provider/action catalog limits configuration-only work to reviewed query families; complex computation, new data systems, write operations, and authorization models require Gateway code and separate acceptance.
