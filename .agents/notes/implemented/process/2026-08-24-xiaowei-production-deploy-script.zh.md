# Agent Note: xiaowei 生产部署脚本

Status: implemented

[English](2026-08-24-xiaowei-production-deploy-script.md) | 中文

## 问题

`dsh-ops` 配套 `scripts/deploy_dsh.sh`——一个六道门的部署流程（预检、备份、同步、安装、重启、健康），负责 systemd 单元、rsync 仓库并 curl `/health`。xiaowei bundle 需要同样的运维形态，外加三项 xiaowei 特有内容：

- **通过 nginx 的公网入口**——桌面客户端连接到面向公网的端口（`:18080`）；api-proxy 绑定 loopback（`:18000`）；nginx 在二者之间反向代理。部署必须同时写入两侧的连线，否则公网客户端会得到 502。
- **`XIAOWEI_TRUSTED_HOSTS` 从部署目标推导**——bundle 的栅栏把公网 IP 识别为受信主机，以便直接命中 `:18080`（而不只是经进程内 loopback）的桌面客户端不会被 403。公网 IP 只有部署脚本这一个地方知道。
- **`server.env` 幂等写入**——`XIAOWEI_ADMIN_EMAIL` / `XIAOWEI_ADMIN_PASSWORD` / `XIAOWEI_MASTER_KEY` 存在于 `/etc/dsh-xiaowei/server.env`，必须在重新部署时不被覆盖（经独立管理员路径的人工密钥轮换不能被重置）。部署脚本的既有实例模式（`-a /opt/dsh-ops /opt/dsh-ops.bak-…`）覆盖代码，但 env 文件是另一回事。

没有这三块，bundle 能启动但桌面客户端无法经公网端口抵达它。

## 决策

`scripts/deploy_xiaowei.sh` 是规范的生产入口。它是 `scripts/deploy_dsh.sh` 的兄弟脚本，沿用同样的六道门形态；差异集中在**gate 3.5**（nginx 片段 + `server.env` upsert）与 **gate 6**（双层健康检查——一层 loopback，一层经 nginx）。

### Gate 3.5：nginx + server.env

部署脚本：

1. 从 `DEPLOY_SSH` 推导 `PUBLIC_HOST_IP`（剥除 `user@`）。
2. 构造 `TRUSTED_HOSTS = "127.0.0.1,localhost,<PUBLIC_HOST_IP>"`，外加运维提供的 `XIAOWEI_TRUSTED_HOSTS_EXTRA`。
3. 写入 `/etc/nginx/conf.d/dsh-xiaowei.conf`：
   - `listen 18080 default_server`（IPv4 + IPv6）。
   - `proxy_pass http://127.0.0.1:18000`。
   - `client_max_body_size 300m` 匹配 `cordis.patch.yml` 的 `maxRequestBodyBytes: 314572800`。
   - `proxy_read_timeout 600s` / `proxy_send_timeout 600s` 保持长智能体轮次存活。
   - WebSocket 升级头（`Upgrade` / `Connection $connection_upgrade`），使 `events.mux` / `events.host` 下行能够抵达 api-proxy——没有它们，nginx 会回 `HTTP 426 Upgrade Required`，桌面永远看不到 host 帧。`map $http_upgrade $connection_upgrade` 块是必需的，因为 nginx 默认在非升级请求上关闭连接。
   - `proxy_set_header Host $host` 让栅栏看到原始权威（否则 nginx 会发送 `Host: 127.0.0.1:18000`，当公网 IP 不在 `trustedHosts` 中时 trusted-host 检查会失败）。
4. 执行 `nginx -t && nginx -s reload`（gate 4.7）——`set -e` 在语法错误时中止，因此下一道门的重启不会在坏掉的反向代理后面启动服务。
5. 写入 `/etc/dsh-xiaowei/server.env`（权限 `0600`）**幂等地**——每个键通过 `if ! grep -F -q '^KEY=' server.env; then printf 'KEY=%s\n' >> server.env; fi` upsert。缺失的键被添加；已有的键被保留。`grep -F`（固定字符串）规避值中的正则元字符陷阱。

### 部署时必需的 env（gate 1）

`XIAOWEI_ADMIN_EMAIL`、`XIAOWEI_ADMIN_PASSWORD`、`XIAOWEI_MASTER_KEY` 是必需的，脚本在任一缺失时在 gate 1 `fail`。它们是 bootstrap 管理员用户与 AES-256-GCM 主密钥——两者都没有默认值，部署缺少它们就不能进行。

### 双层健康检查（gate 6）

- Loopback：`curl --max-time 5 -fsS http://127.0.0.1:18000/health`（5 次尝试，每次间隔 2s）。
- 公网：`curl --max-time 5 -fsS http://127.0.0.1:18080/health`（5 次尝试，每次间隔 2s）。

两者都必须成功。Loopback 探针单独测试 api-proxy；公网探针测试 `nginx → 18000`。任一失败时打印特定的回滚提示：loopback 失败 → 恢复备份树并重启；公网失败 → 检查 nginx 片段与服务的 journalctl。

### 其他环境变量覆盖

- `DEPLOY_SSH`——默认 `root@119.45.252.25`。
- `DEPLOY_DIR`——默认 `/opt/dsh-xiaowei`。
- `DSH_XIAOWEI_PORT`——默认 `18000`（loopback 绑定）。
- `DSH_XIAOWEI_PUBLIC_PORT`——默认 `18080`（nginx 监听）。
- `DSH_HOME_DIR`——默认 `/var/lib/dsh-xiaowei`。
- `XIAOWEI_TRUSTED_HOSTS_EXTRA`——逗号分隔的额外项（局域网侧主机名、内部代理）。
- `SKIP_TYPECHECK`——设置为非空时跳过 gate 1 的 `pnpm run typecheck`。

### systemd 单元

写入 `/etc/systemd/system/dsh-xiaowei.service`：

- `Environment=DSH_HOME=/var/lib/dsh-xiaowei`（数据根）。
- `Environment=DSH_XIAOWEI_PORT=18000`（loopback 绑定）。
- `Environment=XIAOWEI_HOST=127.0.0.1`（强制 loopback 绑定，即便运维 shell 中导出了 `XIAOWEI_HOST`）。
- `EnvironmentFile=-/etc/dsh-xiaowei/server.env`（破折号前缀允许文件缺失——首次部署在 env 文件存在之前很有用）。
- `ExecStart=/usr/bin/env bash -lc 'cd /opt/dsh-xiaowei && pnpm dsh --profile xiaowei'`。
- `Restart=on-failure`、`RestartSec=5s`、`WatchdogSec=30s`（进程不调用 `sd_notify`，因此 watchdog 不会触发）。
- `StandardOutput=journal` / `StandardError=journal`。

### Profile 初始化

脚本写入 `/var/lib/dsh-xiaowei/profiles/xiaowei/package.json` + 一个空的 `cordis.patch.yml`，让 dsh CLI 的 profile 解析器能找到 bundle 依赖。CLI 在启动时通过为每个 workspace 依赖建立符号链接来修复 `profiles/node_modules`；profile 目录本身不跑 `pnpm install`。

### Dry-run

`--dry-run` 打印每个 rsync 目标、每个远程命令、systemd 单元正文、nginx 片段正文、以及 `XIAOWEI_TRUSTED_HOSTS` 的值。它**不**检查必需的 env（gate 1 的 email/password/master-key 检查被跳过），因此 dry-run 不需要真实密钥即可工作。

## 备选方案

- **一个脚本同时部署 `dsh-ops` 与 `dsh-xiaowei`**——拒绝。两个 profile 在运维上是分开的：不同的 systemd 单元、不同的 `DSH_HOME` 根、不同的 `trustedHosts` 策略、不同的公网 nginx 前端。一个统一脚本要么长出条件分支，要么长出每季度分化的两条并行分支。两份形态共享的脚本更易于审计。
- **每次部署只写一次 `server.env` 并覆盖**——拒绝。经运维自身管理员路径的人工密钥轮换（例如 `dsh-ops admin wallet.setQuota` 轮换）写入 `server.env` 且必须在代码重新部署后存活。幂等 upsert 保留运维设置的值。
- **在 systemd 单元中内联 nginx 配置**——拒绝。systemd 不配置 nginx；nginx 片段必须放在规范的包含路径。部署脚本同时写入两半并重新加载 nginx。
- **`curl https://...`（带 Let's Encrypt 的真实 HTTPS）**——不在范围内。当前生产是 `:18080` 上的纯 HTTP；TLS 终止属于 CDN 或前置 LB，不属于 dsh 主机。未来 PR 增加证书路径。
- **使用 systemd socket 激活而非 nginx**——拒绝。nginx 已经在机器上（被 `xiaowei-workbench.conf` 用于 `/releases/`）；再加一个 socket 单元会重复监听。nginx 是公网端口的规范位置。
- **总是从部署目标覆写 `XIAOWEI_TRUSTED_HOSTS`**——拒绝。运维可能添加无法从 `DEPLOY_SSH` 推导的额外受信主机（`XIAOWEI_TRUSTED_HOSTS_EXTRA`）。脚本仅在值不存在时设置；没有该 env 的重新部署保留运维设置的值。
- **将 nginx 内联到 `ExecStartPre`**——拒绝。nginx 以 root 运行，systemd 的 `ExecStartPre` 运行在服务的 cgroup 中；nginx 配置错误会静默杀死部署。独立的 `nginx -t` + `nginx -s reload` gate 4.7 以可见方式捕获它。
- **仅探测 loopback `/health`**——拒绝。一个对每个公网请求都返回 502 的错误配置 nginx 片段会通过 loopback 探针，而生产故障会在首次桌面登录时浮现。双层探针让部署在任何用户受影响之前失败。

## 影响

### 收益

- **一次性生产部署**——`scripts/deploy_xiaowei.sh`（无标志）是运维入口。脚本处理备份、rsync、systemd、nginx、env 文件、重启与双层健康。
- **幂等的 env 文件**——人工密钥轮换在重新部署后存活。
- **可见的失败模式**——nginx 语法错误与 api-proxy 启动失败都在 systemd 单元重启前以特定提示中止部署。
- **镜像 `dsh-ops`**——已经在跑 `scripts/deploy_dsh.sh` 的运维用五分钟学会新脚本。

### 代价

- **两个脚本要维护**——`deploy_dsh.sh` 与 `deploy_xiaowei.sh`。形态共享，细节分化。两个脚本在 systemd 单元名、env 文件路径、公网端口连线、健康探针目标上分化。
- **机器上需要 nginx**——若未安装 nginx 则 gate 4.7 不执行任何动作，但那意味着公网端口未被服务。部署脚本记录告警；不失败。没有 nginx 的机器需要运维手动配置公网端口。
- **部署时需要的 env**——`XIAOWEI_ADMIN_EMAIL` / `XIAOWEI_ADMIN_PASSWORD` / `XIAOWEI_MASTER_KEY` 是强制的。没有真实值的测试部署在 gate 1 失败。脚本刻意不自动生成主密钥——轮换故事依赖运维在外部生成并提交其生命周期。
- **纯 HTTP**——dsh 主机没有 TLS。公网端口终止纯 HTTP；生产级 TLS 在前置 LB 或 CDN。未来 PR。
- **没有 staging-与-production 开关**——脚本总是部署到 `DEPLOY_SSH`（默认生产）。想 staging 部署的运维将 `DEPLOY_SSH` 覆盖到 staging 主机，脚本同等对待；没有 `--environment` 标志。两个脚本、两个 SSH 目标是当前形态；`dsh-deploy-multi` 脚本是未来 PR。