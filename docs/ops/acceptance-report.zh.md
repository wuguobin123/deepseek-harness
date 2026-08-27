# ops 迁移验收报告

[English](acceptance-report.md) | 中文

生成时间：2026-08-23（第 4、5 阶段生产部署已落地；第 6 阶段 Electron 客户端已发布）

将 `/Users/wuguobin/Documents/my-agents`（ServicePilot／小薇办公助手）迁移到 dsh（DeepSeek Harness）基础上的状态。本文是当前已就绪内容、明确延后内容，以及下一阶段运行前操作人员必须确认事项的唯一真源。

## 范围内

承载 my-agents 业务场景的 dsh 侧骨架。报告覆盖包、示例、文档和验证；实际 my-agents 业务对象保留在 `dsh-ops-subagent-python` 后的 Python 对等实现中，直到场景需要它们。

## 范围外

- my-agents Python 运行时（`customer_service_ai.*`）。它在独立进程中保持原样运行，并通过 JSON-RPC 与 dsh harness 交换数据。
- my-agents Electron 桌面端。它由 dsh Web 前端（`apps/web/dist`）替代，后者作为 SPA fallback 通过同一个 `/health` socket 提供。根据操作人员「之前的客户端、用户、数据都可以清掉，不要带有历史包袱」的指令，旧 Electron 客户端已停用。
- OPDCA 编排（`route_work`、`capability_runner`、`evidence_validator`）。根据[决策 0001](./decisions/0001-agent-handoff-event-deferred.zh.md) 明确延后，直到业务场景提出需要。

## 已交付的包

| 包 | 角色 | 文件 |
|---|---|---|
| `@deepseek-ai/dsh-ops-subagent-python` | 通过 stdio JSON-RPC 生成 Python 对等进程的 Subagent 提供方 | `packages/ops/ops-subagent-python/` |
| `@deepseek-ai/dsh-ops-skill` | 扫描 `skills/<name>/SKILL.md` 的内置 Skill 提供方 | `packages/ops/ops-skill/` |
| `@deepseek-ai/dsh-ops-domain` | 预留 `ctx.opsDomain` 的 TS 侧镜像 | `packages/ops/ops-domain/` |
| `@deepseek-ai/dsh-ops-runtime` | 业务 Subagent 的 agent preset 容器 | `packages/ops/ops-runtime/` |
| `@deepseek-ai/dsh-ops-platform`（骨架） | 能力注册表和风险分类体系 | `packages/ops/ops-platform/` |
| `@deepseek-ai/dsh-ops-approval-policy`（骨架） | 批准扩展（`executionVersion`、`risk`、`validForSeconds`、`argumentsHash`） | `packages/ops/ops-approval-policy/` |
| `@deepseek-ai/dsh-ops-package-signing`（骨架） | HMAC-SHA256 包签名 | `packages/ops/ops-package-signing/` |
| `@deepseek-ai/dsh-ops-loop-guard`（骨架） | 五类循环检测 | `packages/ops/ops-loop-guard/` |
| `@deepseek-ai/dsh-ops-workbench-conversations` | 工作台子系统骨架：多轮对话投影 | `packages/ops/ops-workbench-conversations/` |
| `@deepseek-ai/dsh-ops-workbench-memories` | 工作台子系统骨架：OpenViking 记忆适配器 | `packages/ops/ops-workbench-memories/` |
| `@deepseek-ai/dsh-ops-workbench-trigger` | 工作台子系统骨架：跨会话触发器 | `packages/ops/ops-workbench-trigger/` |
| `@deepseek-ai/dsh-ops-workbench-anomaly` | 工作台子系统骨架：异常检测器 | `packages/ops/ops-workbench-anomaly/` |

骨架包注册不执行任何操作的 `apply()` 和配套 `invariant.ts`。首个需要该接口的场景会把它们切换为真实注册。

## 已交付的 profile、部署与运行时

| 接口 | 角色 | 文件 |
|---|---|---|
| `@deepseek-ai/dsh-ops` | 生产长期运行组合包：`dsh-base + ops-startup + webserver (127.0.0.1:18000) + ops-webserver (/health) + ops-frontend-static (SPA dist fallback) + 12 ops-* product plugins + ops-runner` | `packages/bundle/ops/` |
| `scripts/deploy_dsh.sh` | 六道部署检查：预检／备份／同步／安装／重启／健康检查 | `scripts/deploy_dsh.sh` |
| `/etc/systemd/system/dsh-ops.service` | systemd unit：长期运行 `pnpm dsh --profile ops`，无 `WatchdogSec`（进程不调用 `sd_notify`） | 由 `scripts/deploy_dsh.sh` 发布 |
| `.agents/skills/dsh-deploy/SKILL.md` | 操作人员运行的部署 Skill；复用 `deploy-production` 六道检查并适配 dsh | `.agents/skills/dsh-deploy/SKILL.md` |
| `/health` HTTP 路由 | 操作人员和 systemd 存活探针 | `packages/bundle/ops/src/webserver.ts` |
| `/`（SPA fallback） | 浏览器入口：通过 webserver fallback slot 提供 `apps/web/dist/index.html` 和资源 | ops 组合包挂载的 `@deepseek-ai/dsh-host-frontend-static` |

组合包的 `cordis.patch.yml` 声明系统提示词 persona、`dsh-host-webserver` 绑定配置项、`ops-webserver`（`/health` 路由）、`ops-frontend-static`（通过 `distIndex: process.cwd() + '/apps/web/dist/index.html'` 占用 `/` 和 SPA 资源的 fallback slot）、所有 ops 产品插件，以及驱动可选前台任务的 `ops-runner`。启动插件（`ops-startup`）在 `opsStartup` Cordis 服务上发布绑定端口（`DSH_OPS_PORT` 环境变量，默认 `18000`）和可选位置任务，供 `ops-runner` 消费。

## 已交付的文档

| 路径 | 用途 |
|---|---|
| `docs/ops/scenario-integration-contract.md` | Skill 与 Subagent 边界、命名、manifest schema、生命周期、权限 |
| `docs/ops/templates/skill/` | 可直接使用的 Skill 模板和 cordis patch |
| `docs/ops/templates/subagent/` | 可直接使用的 Subagent 模板、Python 对等实现和 cordis patch |
| `docs/ops/templates/verify.py` | 两种模板及内置 `next-best-action` 的无密钥冒烟测试 |
| `docs/ops/decisions/0001-agent-handoff-event-deferred.md` | 延后的 `agent/handoff` 事件及原因 |

## 已交付的示例

| 路径 | 用途 |
|---|---|
| `examples/ops-minimal/` | 第 0 阶段零里程碑：挂载 `ops-subagent-python`，通过协议驱动一次 `agent.turn` |

## 首个迁移场景

| 场景 | 风险 | 来源 | 状态 |
|---|---|---|---|
| `next-best-action`（Skill） | R1（只读） | `my-agents/skills/next_best_action` | 已迁移到 `packages/ops/ops-skill/skills/next-best-action/SKILL.md` |

该 Skill 发布 frontmatter（名称、描述、whenToUse、调用策略、指向源 my-agents skill id 的元数据、版本、风险等级、只读标志）和正文；正文要求模型生成单个有序列表，不调用任何业务侧工具。

## 验证

`docs/ops/templates/verify.py` 中的无密钥冒烟测试不调用模型或网络，即可覆盖两种接入形式和内置 Skill。

```sh
$ python3 docs/ops/templates/verify.py
PASS: subagent wire (initialize + agent.turn)
PASS: skill frontmatter (template:hello-scenario name='hello-scenario', body=1226 chars)
PASS: skill frontmatter (bundled:next-best-action name='next-best-action', body=2082 chars)
OK: scenario接入 templates verify
```

每次提交前必须在干净工作树通过以下静态检查：

```sh
pnpm run typecheck
pnpm run lint
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm -w run build:lib:host   # tsc -b tsconfig.host.json && tsdown (produces lib/*.js)
```

尚未为 `dsh-ops-skill` 记录 skill-filesystem 冒烟测试（`test-snapshot`）；内置提供方可以在干净工作树启动并正确读取 `skills/`。

生产部署冒烟测试（2026-08-23 对 `root@119.45.252.25` 执行）：

```sh
$ scripts/deploy_dsh.sh
[deploy_dsh] gate 1: typecheck
[deploy_dsh] gate 2: remote backup → /opt/dsh-ops.bak-20260822T170129Z
[deploy_dsh] gate 3: rsync to root@119.45.252.25:/opt/dsh-ops
[deploy_dsh] gate 4: pnpm install on remote
[deploy_dsh] gate 4.5: init profile at /var/lib/dsh-ops/profiles/ops
[deploy_dsh] gate 5: systemctl restart dsh-ops
[deploy_dsh] gate 6: health probe http://127.0.0.1:18000/health
[deploy_dsh]   attempt 3/5 passed
[deploy_dsh] deploy complete

$ ssh root@119.45.252.25 'curl -sS http://127.0.0.1:18000/health'
{"status":"ok","service":"dsh-ops","uptime_s":1}

$ ssh root@119.45.252.25 'cd /opt/dsh-ops && DSH_HOME=/var/lib/dsh-ops pnpm dsh --profile ops --dump-config | head -3'
# == @deepseek-ai/dsh-base
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
```

存活状态由 systemd unit（`Restart=on-failure`、`WatchdogSec=30s`）维持；`/health` 路由返回 `200` 和启动时长。根据操作人员「完全弃用」的指令，旧 `xiaowei-app / xiaowei-command-worker / xiaowei-outbox-worker` unit 已执行 `disable --now`；其 `/var/lib/xiaowei-workbench/` 会话日志**不会**迁移。

## 明确延后

| 项目 | 原因 | 重新考虑的触发条件 |
|---|---|---|
| `agent/handoff` 会话事件 | 当前无生产方；会使 `verify-persistence-catalog` 失败 | 首个 ops-runtime 编排器场景 |
| OPDCA 编排器（`route_work`、`capability_runner`、`evidence_validator`） | 根据场景接入决策不在范围内 | 业务场景明确需要多 agent 移交 |
| 批量迁移其余 13 个 my-agents 业务 Skill | 等待单个 Skill 的逐场景接入得到验证 | 下一个业务场景（例如 `oa_workbench`、`hr_workbench`、`customer_insight`） |
| 第 4 阶段工作台子系统（conversations、memories、trigger、anomaly、RAG） | 仅有骨架；完整实现在消费方需要时落地 | 场景需要的首个工作台接口 |
| 第 5 阶段 Electron 桌面迁移 | 由 ops profile 的 webserver fallback slot 提供的 dsh Web 前端替代 | 已完成：旧 Electron 应用已停用；浏览器客户端从 `http://host:18080/` 加载 `apps/web/dist` |
| 第 6 阶段 OTel + Prometheus + 生产加固 | 独立于 agent 运行时；延后 | 产品向外部流量开放前 |

## 操作人员预检清单

运行 `pnpm dsh --profile <profile>` 前，确认：

1. `pnpm install` 已完成，且没有关于新 ops 包的 peer dependency 警告。
2. `pnpm run typecheck` 报告零错误。
3. `pnpm run hygiene` 对新包报告零缺失导出错误。
4. `python3 docs/ops/templates/verify.py` 返回三行 PASS。
5. 需要真实 LLM 调用时已设置 `DEEPSEEK_API_KEY`；验证冒烟测试不需要它。

## 生产部署：已落地

部署于 2026-08-23 在操作人员指定目标 `root@119.45.252.25` 上运行，安装路径为 `/opt/dsh-ops`，harness home 为 `/var/lib/dsh-ops`。部署前已对旧 `xiaowei-*` 服务执行 `disable --now`，释放端口 `18000`；之前位于 `/var/lib/xiaowei-workbench/` 的会话日志保留在原地，但不会读取。

部署内容：

- `scripts/deploy_dsh.sh`：基于 rsync 的六道检查部署（预检／备份／同步／安装／重启／健康）。可重复执行：再次运行会覆盖源码树并重启服务。
- `/etc/systemd/system/dsh-ops.service`：长期运行 systemd unit；`pnpm dsh --profile ops`；`Restart=on-failure`、`WatchdogSec=30s`。
- `/var/lib/dsh-ops/profiles/ops/`：Cordis profile 目录（`package.json` + `cordis.patch.yml`）；CLI 启动时通过 `healProfilesModuleFallback` 修复 `profiles/node_modules/`。
- `/var/lib/dsh-ops/sessions/`：持久会话日志（JSONL）；根据「重新建一份空 session 日志」指令从空状态创建。

当前在任何业务场景落地前提供以下运行保证：

1. `dsh-ops --profile ops` 能够启动，webserver 绑定 `127.0.0.1:18000`，`/health` 和 `/` 返回 `200`。
2. `systemctl restart dsh-ops` 后，`systemctl is-active dsh-ops` 为 `active`；在 90 秒观察窗口内 `NRestarts=0`，且 `uptime_s` 单调增长（禁用 HMR 后已验证）。
3. `dsh-ops --profile ops --dump-config` 先列出 `@deepseek-ai/dsh-base` 层，再列出 `@deepseek-ai/dsh-ops` 层；所有 ops-* 插件配置项均存在，`hmr` 列为 `disabled: true`（`dsh-base` 会启用 HMR，而生产环境不得因文件变化重启，因此覆盖为关闭）。
4. Python 对等实现尚未发布；ops-subagent-python 已注册为提供方，但其 `--module` 默认为 `ops_runtime.subagent_main`（my-agents 中尚未实现）。首个需要该对等实现的场景会在 Python 侧实现该模块。
5. 旧 `xiaowei-*` unit 保持停止；在此主机上重新开启它们不在范围内。

代码变更后重新部署：

```sh
scripts/deploy_dsh.sh
```

回滚（在部署脚本第 6 道检查输出中命名；使用第 2 道检查的 `cp -a` 备份）：

```sh
ssh root@119.45.252.25 'systemctl stop dsh-ops && rm -rf /opt/dsh-ops && mv /opt/dsh-ops.bak-<UTC> /opt/dsh-ops && systemctl start dsh-ops'
```

备份保留是隐式的：每次部署留下 `/opt/dsh-ops.bak-<UTC>`，直到下次部署的 `--delete` rsync 将其清理。本次运行已有的 `/opt/dsh-ops.bak-<UTC>` 为 `/opt/dsh-ops.bak-20260822T170129Z`。

## 第 5 阶段：Web 客户端通过 ops profile 落地

操作人员「按照 C 方案落地，我需要彻底升级使用。之前的客户端、用户、数据都可以清掉，不要带有历史包袱」的指令要求使用 ops profile 自身提供的 dsh Web 前端替代旧 Electron 桌面端，并复用已经承载 `/health` 的 `127.0.0.1:18000` socket。

变更内容：

- `packages/bundle/ops` 将 `@deepseek-ai/dsh-host-frontend-static` 添加为 peer 和开发依赖。其唯一 `Config.distIndex` 是 `apps/web/dist/index.html` 的路径。
- `packages/bundle/ops/cordis.patch.yml` 在 `ops-webserver` 后挂载新的 `ops-frontend-static` 配置项。loader 运行时将 `distIndex` 解析为 `process.cwd() + '/apps/web/dist/index.html'`；systemd unit 固定 `WorkingDirectory=/opt/dsh-ops`，因此生产环境能解析绝对路径。
- `packages/bundle/ops/src/webserver.ts` 不再注册 `/` 精确路由。由 frontend-static 占用的 webserver fallback slot 为 `/` 提供 `index.html`；`/health` 通过精确注册保持优先。`/assets/*` 下的 SPA 资源由 frontend-static 防路径遍历的静态文件处理器提供。
- `scripts/deploy_dsh.sh` 在第 3 道检查中将构建后的 `apps/web/dist/` 树同步到 `/opt/dsh-ops/apps/web/dist/`。本地缺少 dist 时只发出警告，不会硬失败（frontend-static 会返回 404，直到下次构建）。
- 旧 `xiaowei-app`、`xiaowei-command-worker`、`xiaowei-outbox-worker` systemd unit 延续上次运行的 `disable --now` 状态；本次重新部署前已清空 `/var/lib/dsh-ops/` 和 `/opt/dsh-ops/`。

验证（2026-08-23，重新部署后）：

```sh
$ curl -fsS http://119.45.252.25:18080/health
{"status":"ok","service":"dsh-ops","uptime_s":16}

$ curl -fsS http://119.45.252.25:18080/ | head -8
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>DSH Local Build</title>

$ curl -sI http://119.45.252.25:18080/assets/index-clqxG24t.js
HTTP/1.1 200 OK
content-type: text/javascript; charset=utf-8

$ ssh root@119.45.252.25 'systemctl is-active dsh-ops && systemctl show dsh-ops -p NRestarts --value'
active
0

$ ssh root@119.45.252.25 'cd /opt/dsh-ops && DSH_HOME=/var/lib/dsh-ops pnpm dsh --profile ops --dump-config' | grep -B 1 -A 3 ops-frontend-static
- id: ops-frontend-static
  name: '@deepseek-ai/dsh-host-frontend-static'
  config:
    distIndex: !!js process.cwd() + '/apps/web/dist/index.html'
```

浏览器客户端指向 `http://119.45.252.25:18080/`（旧 Electron HTTP API 使用的同一 nginx 前端）。nginx upstream 保持不变（`127.0.0.1:18000`）；`/health` 和 SPA 共享同一个后端 socket。

## 第 6 阶段：Electron 桌面客户端（PR 7 已落地）

旧 Electron 客户端已按操作人员「之前客户端功能直接使用，可以局部改动」的指令调整用途，现位于 `apps/desktop/`。它使用与 dsh Web 前端相同的 dsh RPC 信封和 stream 帧联合类型；两个界面都汇聚到 `@deepseek-ai/dsh-host-apiproxy` 和 ops profile 中有信任防护的 `dsh-client-connection` 挂载项。

### 变更内容

- **协议层**（`PR 4`）：REST 风格 `{ method, path }` 请求改为 dsh `{ type:'client-request', rpcId, method, payload }`。SSE stream（`GET /api/events.mux`、`/api/events.host`）由 main 进程打开，并作为类型化 IPC 事件分发；已移除 `X-API-Key`、`X-Tenant-ID`、`X-Actor-ID` 请求头，`dsh-client-connection` 的 loopback `trustedHosts` 防护是唯一信任检查。
- **Renderer**（`PR 5 + PR 6`）：首页／助手／任务／批准／历史记录／设置；每个页面都调用轻量 `api.<group>.<method>(payload)` 包装层，统一进入 `window.workbenchApi.request`。my-agents 功能界面（telesales、anomalies、triggers、integrations、automations、browser、document-preview、knowledge、resources）已删除，不保留兼容包装层。
- **打包**（`PR 7`）：`electron-builder.yml` 改为 `appId: com.deepseek-harness.desktop`、`productName: DeepSeek Harness`。默认 `product-config.json` 指向 `http://119.45.252.25:18080/`；构建时可用 `WORKBENCH_API_BASE_URL` 覆盖。

### 发布方式

```sh
# Build a release for the operator's machine.
pnpm --filter @deepseek-harness/desktop run package:mac        # arm64 DMG
pnpm --filter @deepseek-harness/desktop run package:mac:x64    # x86_64 DMG
pnpm --filter @deepseek-harness/desktop run package:linux      # AppImage
pnpm --filter @deepseek-harness/desktop run package:win        # NSIS .exe (needs wine on macOS)
```

最近一次验证构建（2026-08-23）：

```text
release/DeepSeek Harness-0.3.0-arm64.dmg       101 MB
release/mac-arm64/DeepSeek Harness.app          bundle, app.asar 26 MB
  CFBundleIdentifier   com.deepseek-harness.desktop
  CFBundleName         DeepSeek Harness
  Resources/product-config.json    {"apiBaseUrl":"http://119.45.252.25:18080"}
```

本地产物使用临时签名。公开分发仍需 Apple Developer ID 和公证；操作人员的机器可以使用 `xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"` 清除 Gatekeeper 隔离。

### 操作人员握手验证

1. 启动 `DeepSeek Harness.app`。
2. 「设置」页面的 `baseUrl` 字段显示内置默认值；点击 **Probe backend**，确认 `host.describe` 返回模型列表（这证明 `/api/host.describe` 通过已有 nginx 前端到达 `127.0.0.1:18000`）。
3. 首页 → **新建会话** → 助手 → 输入任意提示词；响应通过 `/api/events.mux` 传输。待批准项约在 1 秒内显示到**待我处理**；`session/jobs` 显示到**进行中的任务**。

### 已知限制

- 在 dsh-ops 公开 releases endpoint 前，update-checker 是 stub。「设置」页面保留该操作；点击后始终报告 `up-to-date`。
- Renderer 构建会发出 Vite 警告 `Unrecognized target environment "es2024"`（来自根 `tsconfig.base.json`）。该警告对 renderer 无影响；此配置由根配置拥有，而非桌面包。
- macOS 打包跳过代码签名（当前环境没有 Developer ID）。上文记录内部部署的 Gatekeeper 绕过方式；公开发布需要公证。

## 交叉引用

- 部署 Skill：[`.agents/skills/dsh-deploy/SKILL.md`](../../.agents/skills/dsh-deploy/SKILL.md)
- 部署脚本：[`scripts/deploy_dsh.sh`](../../scripts/deploy_dsh.sh)
- Profile 和组合包：[`packages/bundle/ops`](../../packages/bundle/ops/README.zh.md)
- 场景约定：[`scenario-integration-contract.md`](./scenario-integration-contract.zh.md)
- 模板：[`templates/`](./templates/)
- 延后说明：[`decisions/0001-agent-handoff-event-deferred.md`](./decisions/0001-agent-handoff-event-deferred.zh.md)
- Python 对等提供方：[`@deepseek-ai/dsh-ops-subagent-python`](../../packages/ops/ops-subagent-python/README.zh.md)
- 内置 Skill 提供方：[`@deepseek-ai/dsh-ops-skill`](../../packages/ops/ops-skill/README.zh.md)
- 第 0 阶段示例：[`examples/ops-minimal`](../../examples/ops-minimal/README.zh.md)
- 第 6 阶段 Electron 客户端：[`apps/desktop`](../../apps/desktop/README.zh.md)
