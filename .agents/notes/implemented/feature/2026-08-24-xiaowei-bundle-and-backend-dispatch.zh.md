# Agent Note: 小薇组合包启动与后端分派端到端落地

Status: implemented

[English](2026-08-24-xiaowei-bundle-and-backend-dispatch.md) | 中文

## 问题

小薇远程后端一半是代码（`account-identity`、`account-email-verification`、`account-wallet`、`account-model-keys` 服务包，产物注册表，api-proxy 协议方法模块），另一半是部署目标，即 `pnpm dsh --profile xiaowei` 启动器可以引导的 Cordis 组合包；该组合包必须成为 Electron 桌面客户端可访问的长期 HTTP carrier。前半部分已在 PR 2 的 10.1a、10.1a.5、10.1b 步骤落地，后半部分并不完整：组合包不存在，`PROFILE_TEMPLATES` 没有 `xiaowei` 条目，api-proxy 新增的 `account.*`、`account.wallet.*`、`account.modelKeys.*`、`artifact.*` 协议方法没有宿主侧路由注册，`IApiClient` 接口在 connection 和 runtime 测试中都没有相应 stub，已有 `fake-api.client.ts` 文件拒绝分派任何新方法名。启动器报「无法解析 profile 组合包」是可见症状；隐藏缺口是从未在 `XIAOWEI_PORT=18181` 绑定端到端 HTTP carrier，因此桌面客户端没有可连接目标。

## 决策

小薇远程后端 PR（10.1 的步骤 11，以及将其连接到桌面客户端的宿主侧粘合代码）交付：

1. `packages/bundle/xiaowei/`：新的 Cordis profile 组合包 `@deepseek-ai/dsh-xiaowei`，包含三个模块入口（`./index.ts`、`./startup.ts`、`./invariant.ts`）；其 `cordis.patch.yml` 在 `dsh-base` + `dsh-headless` stack 上叠加 `account-identity`、`account-email-verification`、`account-wallet`、`account-model-keys`、`artifact-store-fs`；其 runner 感知 `inject`，没有位置任务时 `apply()` 不执行任何操作；其 `xiaoweiStartup` Cordis 服务从 `XIAOWEI_PORT`（默认 18000）和位置 argv 发布 `{ task, port }`。
2. `packages/boot/app-boot/src/profile.ts:117` 中的 `PROFILE_TEMPLATES.xiaowei = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-xiaowei']`。CLI 启动器现在通过其他 profile 共用的 `resolveBundleDir` 路径解析 `--profile xiaowei`。
3. 将 `@deepseek-ai/dsh-xiaowei` 添加到 `apps/cli/package.json` 的 dependencies，使 workspace 解析的安装锚点能看到组合包。缺少此行时，启动器的双锚点解析（先 `installAnchor`，再 `profileDir`）仍会失败，因为 dsh 应用的 `node_modules` 符号链接集合没有组合包条目。
4. api-proxy 在 `packages/host/apiproxy/src/fetch/handler.ts` 中增加 19 个 `UNARY_ROUTES` 条目：`account.signup`、`account.emailCode`、`account.signin`、`account.signout`、`account.state`、`account.wallet.get`、`account.wallet.credit`、`account.wallet.setQuota`、`account.wallet.refreshDaily`、`account.modelKeys.list`、`account.modelKeys.provision`、`account.modelKeys.revoke`、`artifact.list`、`artifact.read`、`artifact.remove`（各自带 zod 请求／值 schema），以及 `ApiProxy` 字段中的四个领域块 `account`、`wallet`、`modelKeys`、`artifactRegistry`；这些块连接到 `api-proxy.ts` 工厂的 `provide('api', ...)` 块。仅限 loopback 的 `account.wallet.credit`、`account.wallet.setQuota`、`account.wallet.refreshDaily`、`account.modelKeys.provision`、`account.modelKeys.revoke` 位于 `PRIVILEGED_METHODS` 后；`account.wallet.get`、`account.modelKeys.list` 接受 loopback 或 bearer（用户读取自己的记录）；`account.signup`、`account.signin`、`account.signout`、`account.accountEmailCode` 为公开方法（没有 PRIVILEGED 条目）。
5. `IApiClient` 和 `AbstractApiClient` 增加四个新领域块。`packages/client/connection/tests/fake-api.client.ts` 和 `packages/client/runtime/tests/fake-api.client.ts` 增加匹配的只读 `account`、`wallet`、`modelKeys`、`artifactRegistry` 块，用于记录方法调用并返回 `ok(...)` 信封。`packages/client/connection/src/client/fixture.ts` 增加相同四个块，以及 `dispatch()` 中包含 19 个分支的 `switch (method)`。
6. `packages/account/email-verification/src/index.ts` 的 `Config` 扩展为接受 `transportKind: z.union(['logging', 'smtp']).default('logging')` 及 SMTP 字段；`LocalEmailVerificationProvider` 根据解析后的 kind 构建 `LoggingEmailSender` 或 `SmtpEmailSender`，组合包 `cordis.patch.yml` 通过 `transportKind: !!js "(process.env.XIAOWEI_SMTP_HOST ? 'smtp' : 'logging')"` 切换传输方式。

Cordis 启动模块（`packages/bundle/xiaowei/src/startup.ts`）在 `ctx.xiaoweiStartup` 上发布 `{ task: <positional argv joined by space>, port: <XIAOWEI_PORT or 18000> }`。与 `@deepseek-ai/dsh-headless/startup` 不同，它不会在 argv 为空时调用 `program.error`：长期 HTTP carrier 的正常状态就是空闲，只有前台任务 runner 会响应非空任务。`ctx.xiaoweiStartup.task` 为空时 runner 不执行任何操作；存在任务时，它通过 `ctx.agents` 驱动一个轮次并打印最终 assistant 消息。

除引导代码外，还需要三个 patch 才能真正启动。

**当 JS 表达式包含后跟空格的 `:` 时，YAML `!!js` 标量必须使用双引号。** `entryListSchema` 是 `yaml.JSON_SCHEMA.extend(JsExpr)`；YAML 会把未加引号标量中的 `: ` 解析为映射键值分隔符。表达式 `(process.env.XIAOWEI_SMTP_HOST ? 'smtp' : 'logging')` 作为单个 block 标量可以正确解析；同一表达式作为普通 `!!js` 标量会解析失败并得到 `{"[object Object]":"logging"}`，运行时看到的是一个键为字面字符串 `"[object Object]"` 的对象。为每个 `!!js` 值添加双引号（不依赖 `!!js` 自身抑制 YAML flow）可使整个 patch 文件加载。`packages/bundle/xiaowei/cordis.patch.yml:99` 内联记录了这一点。

**`artifact-store-fs` 已经注册 `ArtifactRegistry`；同一 `- insert` 块中的裸 `artifact` 配置项会重复注册，**导致 api-proxy 挂载阶段抛出 `service "artifactRegistry" has been registered at <LocalArtifactRegistry>`。裸配置项已删除，只保留 `artifact-store-fs`。抽象 `@deepseek-ai/dsh-artifact` 包只用于类型声明合并，不是 loader 配置项。

**xiaowei profile 继承 `dsh-headless`，而其 `headless-startup` 会在 argv 为空时调用 `program.error`。** 这会在小薇 webserver 绑定前触发。小薇 patch 增加 `- id: headless-startup / disabled: true`，并对 `headless-runner` 做相同处理；长期 HTTP carrier 成为唯一入口。dsh-headless 核心（agent、session、llm）保持不变，只替换一次性粘合层。

## 后果

`pnpm dsh --profile xiaowei` 现在会在 `XIAOWEI_PORT`（默认 18000）启动长期 HTTP carrier。通过 `curl` 对实时进程验证以下协议方法均返回完整信封：

- `account.emailCode({ email })` → `{ expiresInSeconds: 600, retryAfterSeconds: 60 }`
- 缺少 `verificationCode` 的 `account.signup` → `code: 'verification-code-required'`
- `verificationCode` 错误的 `account.signup` → `code: 'email-code-wrong', attempts remaining: 4`
- `account.wallet.get({ userId })` → `{ userId, balanceMicros: 0, updatedAt: 0 }`
- `artifact.list({ workspaceId })` → `{ items: [] }`
- `host.describe({})` → 完整宿主描述（loopback 可信）

真实 HTTP 客户端可以端到端访问完整方法接口；api-proxy schema 在协议边界以结构化 Zod 错误拒绝格式错误的信封。后续 PR 会增加桌面 IPC bridge（`apps/desktop/src/main/ipc-handlers.ts` → `workbench:auth:*`）、bearer token 持久化层（`apps/desktop/src/main/credential-store.ts` v3 → `api-client.ts` 中的 `setToken`）和 renderer SignInCard。

## 考虑过的替代方案

**在一个 `cordis.yml` 中同时包含 dsh-base patch 和小薇专用配置项的组合包。** 已拒绝，因为这会在小薇发布产物中复制 `dsh-base` 配置项，并破坏其他 profile（`headless`、`web`、`ops`）已经采用的分层模型。组合包叠加模式是既有约定；小薇组合包只贡献小薇专用配置项。

**从小薇模板完全禁用 headless 组合包。** 已拒绝，因为 `dsh-headless` 提供前台任务 runner 和 api-proxy 会话方法依赖的 agent loop、会话运行时及 LLM 消费方。禁用整个组合包会让 HTTP carrier 仍能绑定，但每个调用 `ctx.agents` 的特权方法都会失败。只对 `headless-startup` 和 `headless-runner` 设置 `disabled: true`，可以精确删除一次性粘合层。

**在 `email-verification` 的 `Config` 中为 `transportKind` 字段使用 schemastery `z.literal`。** 已拒绝，因为项目的 `vendor/schemastery` fork 不公开 `z.literal`；内联 `z.union(['logging', 'smtp'])` 是该 seam 其他配置使用的形式。缺陷位于 YAML，而非 schema。
