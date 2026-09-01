---
sdd:
  id: feature.xiaowei.business-skill-hot-loading
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-skill-hot-loading-001
      text: Every business Skill lookup and operation derives the account from the authenticated principal or durable Session owner, and user or model arguments cannot supply or override userId, tenantId, credentials, or authorization fields.
    - id: REQ-xiaowei-business-skill-hot-loading-002
      text: An authenticated account can validate, publish, disable, and roll back a versioned data-only business Skill definition without restarting the Host or changing deployed source code.
    - id: REQ-xiaowei-business-skill-hot-loading-003
      text: A successful publish becomes visible to the account on the next Skill lookup, while a failed publish preserves the last active version and an in-flight operation retains the version resolved at dispatch.
    - id: REQ-xiaowei-business-skill-hot-loading-004
      text: The model reaches configured operations only through one stable business tool whose executor repeats installation, active-version, operation, schema, connection, and credential-policy checks before external I/O and passes the required permission to the business API.
    - id: REQ-xiaowei-business-skill-hot-loading-005
      text: Business Skill definitions contain credential references and approved connection ids only; resolved credential values and authenticated identity fields never enter model messages, tool arguments, configuration responses, or audit payloads.
  acceptance:
    - id: ACC-xiaowei-business-skill-hot-loading-001
      text: Focused service and executor tests reject reserved identity fields, invalid schemas and inputs, cross-account lookup, disabled definitions, and stale revisions, and prove trusted identity and required-permission propagation.
      evidence:
        - packages/business/skill-sqlite/tests/skill-sqlite.spec.ts
        - packages/business/runtime/tests/runtime.spec.ts
        - packages/business/connector-http/tests/connector-http.spec.ts
    - id: ACC-xiaowei-business-skill-hot-loading-002
      text: An assembled runtime publishes a definition, refreshes the account Skill catalog for the next step without process replacement, retains the last active version after invalid input, and rolls back by switching the active version.
      evidence:
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-business-skill-hot-loading-003
      text: Authenticated RPC and client checks derive ownership from the principal and expose versioned definitions without account ids, credential values, or authorization headers.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-business-skills.spec.ts
        - packages/host/apiproxy/tests/client-handler.spec.ts
    - id: ACC-xiaowei-business-skill-hot-loading-004
      text: The Xiaowei configuration surface validates, publishes, disables, and rolls back one business Skill and reports the active version and validation failures.
      evidence:
        - packages/client/ui-settings-business-skills/tests/components.client.spec.tsx
        - packages/client/ui-settings-business-skills/tests/browser-plugin.client.spec.tsx
  evidence:
    - packages/business/skill/src/index.ts
    - packages/business/skill-sqlite/src/index.ts
    - packages/business/runtime/src/index.ts
    - packages/business/connector-http/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
  decisions:
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.zh.md
    - docs/architecture.zh.md
---
# 小薇业务 Skill 热加载

[English](business-skill-hot-loading.md) | 中文

该功能增加账号隔离、仅包含数据的业务 Skill 运行时。平台代码、稳定的模型可见工具、连接提供方、授权检查与存储服务只部署一次；后续业务定义作为版本化配置经过校验和发布。

## 运行时规则

认证 principal 与持久 Session owner 是仅有的账号选择来源。业务操作输入 schema 拒绝身份与凭据保留名称，运行时只在解析当前账号后注入可信身份。受控连接器把可信身份与操作要求的权限传给业务 API，由业务 API 作出权威的用户权限判断。

发布会先校验完整定义及其引用的全部连接，再在一个事务中写入不可变版本并推进 active 指针。提交成功后刷新 Skill 注册表。停用和回滚只更新 active 指针，不加载可执行代码；校验失败会保留最后一个 active 版本。

稳定的 `business_skill_call` 工具只接受 Skill 名称、操作 ID 与操作自身的业务输入。它解析一个 active 版本，按声明的 schema 校验输入，在操作边界取得凭据，通过已批准连接器执行，校验并限制响应，并记录不含秘密的审计结果。

## 验证

聚焦检查覆盖解析器、持久化、工具执行、连接器策略、认证 RPC 与设置客户端。组装后的 keyless 小薇运行时证明发布、失败更新保留、账号隔离、停用和回滚会在不替换进程的情况下改变下一次 Skill 查询结果。
