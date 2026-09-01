# `@deepseek-ai/dsh-business-gateway`

English | [中文](README.zh.md)

This independent Node process exposes reviewed, read-only Xiaowei identity metrics on loopback. It authenticates the deployment service bearer, validates the Host-derived user, checks a hot-loaded grant, opens `identity.sqlite` read-only with `query_only`, and audits the outcome before returning a bounded result. It never receives the Xiaowei login token.

## Configuration

The process requires `DSH_BUSINESS_GATEWAY_CONFIG`, `DSH_GATEWAY_DATABASE_ROOT`, `DSH_BUSINESS_GATEWAY_AUDIT`, `DSH_BUSINESS_GATEWAY_PORT` from 1 through 65535, and `XIAOWEI_BUSINESS_API_TOKEN`. Database and audit locations are startup policy, not hot configuration. The JSON snapshot accepts only `revision`, `operations`, and hashed `grants`:

```json
{
  "revision": 2,
  "operations": [
    {
      "id": "share-code-unused",
      "path": "/metrics/share-code-unused",
      "provider": "xiaowei-identity",
      "action": "unconsumed-invitation-count",
      "permission": "metrics.share-codes.available.read",
      "ownerScoped": true
    }
  ],
  "grants": [
    {
      "subjectHash": "<sha256-of-host-derived-user-id>",
      "permissions": ["metrics.share-codes.available.read"]
    }
  ]
}
```

Configuration cannot contain SQL, arbitrary URLs or headers, credentials, `userId`, or `tenantId`. The registered actions are `registered-account-count`, `registered-user-page`, `consumed-invitation-count`, and `unconsumed-invitation-count`. Account count and registered-user pages are global; invitation actions are always owner-scoped. The page operation requires independent `users.details.read` permission and returns only masked email and calendar-date fields. Count responses are limited to 512 UTF-8 bytes and detail responses to 4096 bytes; oversized responses return a small 503 and are not included in audit records. The Skill manifest separately owns model-facing input and output JSON schemas.

Replace the complete file atomically. The next request uses the new validated snapshot without replacing the Gateway or Xiaowei process; an invalid file retains the last-good snapshot. Requests fail closed for an unavailable credential, invalid bearer, tenant header, missing or unknown user, permission mismatch, missing grant, query or body input, unavailable audit sink, or unregistered operation.

## Deployment

The supplied `deploy/dsh-business-gateway.service` listens on `127.0.0.1:18082`. `deploy/seed-config.mjs` converts the legacy deployment grants to subject hashes without placing raw account ids in Gateway configuration. nginx keeps TLS termination at `business.xiaowei.internal`; cutover changes only its upstream from port 18000 to 18082 and reloads nginx. Rollback restores port 18000, reloads nginx, and stops the Gateway without changing account, Session, Skill, configuration, or audit data.

## Model Experience

### Independent business execution

#### What the model sees

Nothing directly. The existing `business_skill_call` Tool and account-owned Skill manifest remain the model-visible interface.

#### Token effect

None from this package. Skill catalog and Tool events retain their existing token costs.

#### KV Cache effect

None from this package. A hot-published Skill revision may change later model input through the existing business Skill runtime.

## Known Limitations and Deferred Work

- Configuration-only additions are limited to registered read actions. A new data source, complex calculation, write operation, credential policy, or authorization model requires Gateway code and an independent Gateway restart, but does not require Xiaowei source changes or a Xiaowei restart.
