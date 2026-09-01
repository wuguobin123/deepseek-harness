# Business HTTPS Connector

English | [中文](README.zh.md)

Bounded HTTPS GET connector with approved hosts, the default HTTPS port, no redirects, timeout, JSON, and response-byte limits. It injects `X-Xiaowei-User-Id` and `X-Xiaowei-Required-Permission` from the trusted Session and manifest; neither value is accepted from model input.

## Model Experience

### HTTPS connector

#### What the model sees

Nothing directly. The `business_skill_call` runtime validates and renders a successful JSON response; transport headers, credentials, and errors remain outside model context.

#### Token effect

None directly; only the consumer's bounded result can contribute tokens.

#### KV Cache effect

None. HTTPS execution does not change the registered model schema or Skill guidance.

## Known Limitations and Deferred Work

- POST and user OAuth credentials require a separately reviewed connector.
