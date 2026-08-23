---
name: dsh-deploy
description: 将本仓库 dsh ops profile 部署到生产服务器（默认 root@119.45.252.25:/opt/dsh-ops）的标准流程：6 道门（预检/备份/同步/安装/重启/健康），含 systemd 单元、dsh-ops profile、pnpm dsh 入口、/health 健康检查、回滚命令。当用户要部署/发布/上线 dsh ops profile 或刷新 dsh-ops 服务时使用。
---

# dsh-ops 生产部署

## 一键部署（首选）

仓库根目录执行：

```bash
scripts/deploy_dsh.sh                # 正式部署
scripts/deploy_dsh.sh --dry-run      # 预演：只打印同步清单与远端命令
```

脚本固定六道门，任一失败即中止（健康检查失败会打印回滚命令并退出非零）：

1. **预检**：本地 `pnpm run typecheck`；工作区脏则警告（部署内容与远程不一致）；SSH 免密连通性（不通直接中止）。
2. **远端备份**：`cp -a /opt/dsh-ops /opt/dsh-ops.bak-<UTC时间戳>`；目录不存在则 `mkdir -p`。
3. **代码同步**：`packages/` / `vendor/` / `scripts/` / `tsconfig.{base,host}.json` / `pnpm-workspace.yaml` / `package.json` / `pnpm-lock.yaml` 全部 `rsync --delete` 同步到 `/opt/dsh-ops/`。同步 systemd unit `/etc/systemd/system/dsh-ops.service`。**排除 `node_modules`、`.git`、`__pycache__`、`.cache`、`*.bak-*`、`.venv`**。
4. **依赖安装**：远端 `cd /opt/dsh-ops && pnpm install --prefer-offline --prod`。
5. **重启**：远端 `systemctl daemon-reload && systemctl enable dsh-ops && systemctl restart dsh-ops`。
6. **健康检查**：远端 `curl --max-time 5 -fsS http://127.0.0.1:18000/health`，5 次重试，每次间隔 2s。

环境变量覆盖：
- `DEPLOY_SSH`（默认 `root@119.45.252.25`）
- `DEPLOY_DIR`（默认 `/opt/dsh-ops`）
- `DSH_OPS_PORT`（默认 `18000`）
- `DSH_HOME_DIR`（默认 `/var/lib/dsh-ops`）
- `SKIP_TYPECHECK`（默认 unset；非空跳过本地类型检查）

## systemd 单元

由脚本同步写入 `/etc/systemd/system/dsh-ops.service`：

```ini
[Unit]
Description=dsh ops profile (long-running agent harness)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dsh-ops
Environment=DSH_HOME=/var/lib/dsh-ops
Environment=DSH_OPS_PORT=18000
EnvironmentFile=-/etc/dsh-ops/server.env
ExecStart=/usr/bin/env bash -lc 'cd /opt/dsh-ops && pnpm dsh --profile ops'
Restart=on-failure
RestartSec=5s
WatchdogSec=30s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

进程不退出：dsh-ops profile 的 runner 是 long-running（与 dsh-headless 不同），HTTP `/health` 是 systemd 的活体信号。

## dsh-ops profile 行为

- `pnpm dsh --profile ops` 启动 `cordis.patch.yml`：`dsh-base + ops-startup + webserver (127.0.0.1:18000) + ops-webserver` 注入 `/health` 路由和 `/` 索引；12 个 ops-* 业务插件按需装配。
- `ops-startup` 读 `DSH_OPS_PORT`（默认 18000）和位置参数（`pnpm dsh --profile ops "task"`）；空任务时进程 idle，HTTP 处理 `/health`。
- `/health` 返回 `{"status":"ok","port":18000,"service":"dsh-ops","uptime":<sec>,"pid":<n>}`。

## 前置条件

- 部署机对服务器有**免密 SSH**（密钥或 ssh-agent）。脚本用 `BatchMode=yes`，需要交互输密码会直接失败——先自行 `ssh $DEPLOY_SSH true` 验证。
- 要部署的代码**先提交并推送**（脚本报 WARNING 不阻断，但部署未提交代码会让生产与仓库漂移，事后无法追溯）。
- 远端需要有 `pnpm >= 9`、`node >= 22.19`、systemd（脚本不安装）。
- 远端 `/etc/dsh-ops/server.env` 不在仓库、不随部署改写；改密钥/单价走 ops-admin 接口，不靠改 env 重启。

## 部署后验证（必做，不可省）

1. `/health` 已在脚本内验证；再确认公网入口：`curl -fsS http://xiaowei.119.45.252.25.nip.io/health`。
2. 走一遍 ops-* 业务链路（按场景对接，具体见 `docs/ops/`）：
   - 多轮对话（ops-workbench-conversations）
   - 记忆/触发/异常（ops-workbench-*）
   - 业务 Skill（按场景接入，单条单包）
3. 若本次改动涉及 `cordis.patch.yml` 或新增 ops-* 插件，确认服务启动日志无 `error` 级条目：
   ```bash
   ssh $DEPLOY_SSH journalctl -u dsh-ops -n 200 --no-pager
   ```
4. 配置 dump（确认 plugin 树装载正确；`--dump-config` 必须在 monorepo 根目录执行，并显式 `DSH_HOME`）：

   ```bash
   ssh $DEPLOY_SSH 'cd /opt/dsh-ops && DSH_HOME=/var/lib/dsh-ops pnpm dsh --profile ops --dump-config'
   ```

   第一段应是 `# == @deepseek-ai/dsh-base`，后续段按 dsh-base → bundle/ops 顺序；`/health` 与 `/` 路由应出现在 webserver 与 ops-webserver 段中。

## 回滚

```bash
ssh $DEPLOY_SSH 'systemctl stop dsh-ops && rm -rf /opt/dsh-ops && mv /opt/dsh-ops.bak-<UTC时间戳> /opt/dsh-ops && systemctl start dsh-ops'
```

`<UTC时间戳>` 取部署时脚本输出的备份标记（形如 `20260823T010203Z`）。**不要动 `/var/lib/dsh-ops/` 数据目录**（session 日志与 token cache 都不可重建）。

## 注意事项（勿再踩）

- **dsh-ops profile 是 long-running**：headless profile 跑一次退出，ops profile 不退出；systemd `WatchdogSec=30s` + `/health` 必须保持 200。
- **首次部署会重建 `/var/lib/dsh-ops/`**：旧 `xiaowei-*` session 日志不迁，按迁移决策**完全弃用**；新部署从空 session log 开始。
- **旧 `xiaowei-app/xiaowei-command-worker/xiaowei-outbox-worker` 服务已弃用**：本 skill 不重启它们；如需彻底停用：
  ```bash
  ssh $DEPLOY_SSH 'systemctl disable --now xiaowei-app xiaowei-command-worker xiaowei-outbox-worker'
  ```
- 本 skill 只覆盖**后端** ops profile 部署；Electron 桌面端走 `desktop-packaging` skill（Phase 5 后续）。
- 升级 ops-* 业务插件时，先在 staging 跑 `pnpm dsh --profile ops --dump-config` 确认 plugin 树无回归，再上生产。
- **rsync 必须包含 `native/`、`apps/`、`patches/`、`scripts/`、所有 `tsconfig.*.json`、`pnpm-lock.yaml`**：`native/landlock-run` 提供 sandbox-local 依赖的 landlock 二进制；`patches/` 含 `node-pty` 的 patch；缺一即构建失败或运行时 `ERR_MODULE_NOT_FOUND`。
- **远端不需要 profile 目录的 `pnpm install`**：CLI 启动时 `healProfilesModuleFallback` 自动给 `$DSH_HOME/profiles/node_modules/<pkg>` 建软链，bundle 包通过父回溯解析。profile 目录只需 `package.json` + `cordis.patch.yml`。
- **`!!js` 配置插值只在 loader 解析时跑一次**：不能在 `cordis.patch.yml` 里用 `!!js ctx.opsStartup.port`，因为 `ops-startup` 的 `apply` 还没执行；直接读 `process.env` 或在插件 `apply` 里读 ctx 服务。
- **每个 bundle 包的 `tsdown.config.ts`** 决定哪些 `lib/types/*.js` 出 `lib/*.js`：根 `tsdown.config.ts` 只出 `{index,invariant,startup}.js`，新增 subpath 入口（如 `./webserver`）必须配 per-package tsdown 覆盖。
- **No-op skeleton 的 `inject` 必须真实存在**：ops-approval-policy / ops-loop-guard 是 skeleton，引用 `userApproval` / `repeatToolReminder` 服务名挂掉启动；Phase 1 全部 `inject: []`，等真实场景再注入。
- **`!!js` 配置插值只在 loader 解析时跑一次**：不能在 `cordis.patch.yml` 里用 `!!js ctx.opsStartup.port`，因为 `ops-startup` 的 `apply` 还没执行；直接读 `process.env` 或在插件 `apply` 里读 ctx 服务。
- **`dsh-base` 默认开启 `hmr` 插件**：`root: [.]` 监视源码变更并重启 agent。生产长跑场景（systemd / `dsh-ops` profile）必须在 `cordis.patch.yml` 里覆盖 `- id: hmr / disabled: true`，否则每次代码 rsync 都触发 agent 重启，session log 损坏，HTTP 端口被绑/解绑轮替。
- **systemd `WatchdogSec` 要求 `sd_notify`**：dsh Node 进程不调用 sd_notify，systemd 每 30s SIGABRT 杀掉。prod unit **不写 `WatchdogSec=`**——liveness 由 `/health` 路由 + `Restart=on-failure` 提供，systemd 看到 exit-code 非零才重启。
- **/health payload 不能用模块加载时常量**：plugin 文件级 `const HEALTH_PAYLOAD = JSON.stringify({...})` 在 require 时执行一次，永远显示 `uptime_s: 1`。要把 uptime 计算放进 handler，每请求生成新 payload。
- **SPA dist 与 `/health` 共享同一 webserver**：浏览器端用 `@deepseek-ai/dsh-host-frontend-static` 的 fallback seat，`/health` 走 exact 路由保留优先级；`/` 由 fallback 提供 `index.html`。把 `/` 的 exact 注册从 ops-webserver 拿掉，不然 SPA fallback 永远吃不到根路径。
- **`!!js` 表达式看不到 `path`/`node:path`**：loader 的 `evaluate = new Function('ctx','expr', ...)` 是独立 scope，CommonJS `require` 在 ESM 编译产物里不一定可用。绝对路径用 `process.cwd() + '/...'` 拼（前缀固定为部署目录），或者写在 plugin 的 `apply()` 里读 `process.cwd()`。