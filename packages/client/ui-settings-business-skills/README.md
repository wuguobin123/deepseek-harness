# @deepseek-ai/dsh-client-ui-settings-business-skills

English | [中文](README.zh.md)

This browser plugin adds an account-scoped `business-skills` tab to Settings → Plugins. It lists Skill identity, active version, revision, and enabled state; accepts YAML or JSON manifests; and exposes validation, publishing, disabling, and optimistic-revision version rollback. The UI displays generic operation errors and never renders transport details or secrets.

The browser face calls the authenticated `connection.api.businessSkills` methods. The Host remains responsible for authentication, account ownership, manifest parsing, authorization, and revision conflicts.

## Model Experience

### Settings surface

#### What the model sees

The `business-skills` Settings tab registers no model context or Tools; it only manages definitions through authenticated RPC.

#### Token effect

The browser UI contributes no tokens.

#### KV Cache effect

None. Successful mutations ask the Host to refresh its Skill catalog for later model steps.

## Known Limitations and Deferred Work

- The editor accepts raw YAML or JSON; form-generated operation schemas and diff review are deferred.
