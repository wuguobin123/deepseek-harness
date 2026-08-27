# `@deepseek-ai/dsh-account-api-provider`

Cloud-only account route ownership for the Xiaowei Host API. The package owns
account, wallet, model-key, custom-model, and account-plugin method
classification plus the account-owner policy and error-code mapping. It has no
dependency on the Host API gateway or the device runtime, so a device bundle
can omit it entirely.

`assertRoutePartition` is the assembly gate: the complete wire method registry
must be the disjoint union of the device-safe core routes and
`ACCOUNT_RPC_METHODS`.
