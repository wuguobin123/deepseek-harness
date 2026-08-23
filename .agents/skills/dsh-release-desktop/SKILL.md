---
name: dsh-release-desktop
description: 打包并发布 dsh Electron 桌面客户端（DeepSeek Harness.app / .exe / .AppImage）到生产环境（119.45.252.25:18080 同一 nginx 上 /releases/ 目录）的标准流程：构建 → 静态验证 → 多平台打包 → rsync 到 dsh-ops host → 生成 latest.json 与 COS 同步 → 一键安装脚本。当用户要打包、发布、上线桌面客户端，或者要给运营交付新版本安装包时使用。
---

# dsh Electron 桌面客户端发布

Electron 客户端在 `apps/desktop/`。前端 dsh RPC + MuxFrame/HostFrame envelope 由 `apps/desktop/src/shared/contracts.ts` 描述，后端契约在 `packages/host/apiproxy/`。后端部署走 [`dsh-deploy`](../dsh-deploy/SKILL.md)；本 skill 只覆盖桌面端。

## 一键发布（首选）

仓库根目录执行：

```bash
# 1. 打包四个目标产物
apps/desktop/scripts/package-release.sh

# 2. 发布到 dsh-ops host（默认 root@119.45.252.25:/var/lib/dsh-ops/releases）
apps/desktop/scripts/publish-client-release.sh

# 或一条龙：先 --dry-run 验证产物与目标
apps/desktop/scripts/publish-client-release.sh --dry-run
```

## 流程与脚本职责

```
┌──────────────────────────┐    ┌───────────────────────────────┐
│ package-release.sh       │    │ publish-client-release.sh     │
├──────────────────────────┤    ├───────────────────────────────┤
│ 1. pnpm install          │    │ 1. 读 package.json version    │
│ 2. tsc --noEmit          │ ──>│ 2. 扫描 release/ 匹配产物     │
│ 3. vitest run            │    │ 3. 生成 latest.json           │
│ 4. vite build (renderer) │    │ 4. rsync 到 dsh-ops host      │
│ 5. electron-builder ×N   │    │ 5. 重建 latest-* 软链         │
└──────────────────────────┘    │ 6. (可选) 同步到腾讯云 COS   │
                                 └───────────────────────────────┘
                                          │
                                          ▼
              ┌────────────────────────────────────────────┐
              │ /var/lib/dsh-ops/releases/                 │
              │   DeepSeek Harness-<ver>-arm64.dmg         │
              │   DeepSeek Harness-<ver>-x64.dmg           │
              │   DeepSeek Harness-<ver>-x64.exe           │
              │   DeepSeek Harness-<ver>.AppImage          │
              │   latest.json                              │
              │   latest-mac-arm64.dmg  -> ...dmg          │
              │   latest-mac-x64.dmg    -> ...dmg          │
              │   latest-win-x64.exe    -> ...exe          │
              │   latest-linux-x64.AppImage -> ...         │
              │   install-mac.sh                          │
              │   install-win.bat                         │
              └────────────────────────────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
   运营/用户一行命令安装：                          浏览器/博客下载按钮：
   bash install-mac.sh                              https://<bucket>.cos.<region>.myqcloud.com/latest-*
   call install-win.bat
```

## package-release.sh 详解

固定五道门，任一失败即中止：

1. **`pnpm install`** — `--prefer-offline`，避免每发版都重新下 registry。
2. **`pnpm run typecheck`** — `tsc --noEmit`。**不要用 SKIP_TYPECHECK 跳过**，类型错误会在 renderer dev 阶段崩出来。
3. **`pnpm run test`** — Vitest。当前仅 `tests/contracts.test.ts`，9 个 case 覆盖 dsh RPC envelope + MuxFrame/HostFrame。
4. **`pnpm run build:renderer`** — Vite 构建 `dist/renderer/`。main/preload 由 electron-builder 自带 tsc 链路处理。
5. **`electron-builder`** — 按 platform 列表执行 `package:mac` / `package:mac:x64` / `package:linux` / `package:win`。

参数：
- `--mac` / `--mac:x64` / `--linux` / `--win` — 只打某个目标。默认四个全打。
- `SKIP_TESTS=1` — 跳过 vitest（CI 上游已跑过）。
- `SKIP_INSTALL=1` — 跳过 pnpm install（容器/CI 缓存场景）。
- `WORKBENCH_API_BASE_URL=...` — 打包前临时把 `product-config.json` 指向别的后端。**默认 `http://119.45.252.25:18080/`**，与 `apps/desktop/product-config.json` 一致。

产物落在 `apps/desktop/release/`：

```text
DeepSeek Harness-<version>-arm64.dmg      101 MB
DeepSeek Harness-<version>-x64.dmg        105 MB
DeepSeek Harness-<version>-x64.exe         81 MB
DeepSeek Harness-<version>.AppImage       112 MB
mac-arm64/DeepSeek Harness.app/                  # 解包后的 .app
mac/DeepSeek Harness.app/                        # x64 同上
linux-unpacked/                                 # AppImage 解包目录
win-unpacked/                                   # NSIS 解包目录
```

每个 `.app` / `.exe` / AppImage 都内嵌了：
- `CFBundleIdentifier = com.deepseek-harness.desktop`（mac）
- `ProductName = DeepSeek Harness`（win）
- `Resources/product-config.json = {"apiBaseUrl": "..."}`

## publish-client-release.sh 详解

两段腿，互不依赖：

### rsync 到 dsh-ops host

```bash
ssh $DEPLOY_SSH mkdir -p /var/lib/dsh-ops/releases
rsync -az --progress latest.json <packages> $DEPLOY_SSH:/var/lib/dsh-ops/releases/
ssh $DEPLOY_SSH 'cd /var/lib/dsh-ops/releases && ln -sf <real> latest-*'
```

- `DEPLOY_SSH` 默认 `root@119.45.252.25`。
- `RELEASES_DIR` 默认 `/var/lib/dsh-ops/releases`。
- 必须免密 SSH（密钥或 ssh-agent）。脚本用 `BatchMode=yes`，交互输密码会直接失败——先 `ssh $DEPLOY_SSH true` 验证。
- 软链 `latest-mac-arm64.dmg` 等是 install-mac.sh / install-win.bat 的稳定下载入口。
- `latest.json` 是 update-checker stub 的未来消费契约（version + files 字典 + notes）。

### 腾讯云 COS（国内 HTTPS 主通道）

```bash
coscli cp release/<file> cos://$COS_BUCKET/latest-* \
  -i $COS_SECRET_ID -k $COS_SECRET_KEY \
  -e cos.$COS_REGION.myqcloud.com
```

- 桶默认 `wgb123-1257121815`，region 默认 `ap-beijing`，与之前 my-agents 客户端相同（可换）。
- 密钥走环境变量，**不写 coscli 配置文件**（避免落盘到 `~/.cos.yaml`）。
- 没有 `COS_SECRET_ID` / `COS_SECRET_KEY` / `coscli` 时，用 `--skip-cos` 只走 rsync。
- `--dry-run` 打印所有动作不真跑——预演必备。

## 一键安装脚本

- `scripts/install-mac.sh` — mac 终端粘贴：`bash -c "$(curl -fsSL https://<bucket>.cos.<region>.myqcloud.com/install-mac.sh)"`。**关键步骤是 `xattr -dr com.apple.quarantine`**：adhoc 签名未公证的 DMG 会被 Gatekeeper 误报"已损坏，无法打开"。
- `scripts/install-win.bat` — Windows cmd 粘贴：`curl -fsSL -o "%TEMP%\install-win.bat" <URL> && call "%TEMP%\install-win.bat"`。**关键步骤是先卸载旧版**：未签名 NSIS 在旧版文件被运行时占住时会 abort with "Failed to uninstall old application files"。
- Linux 没有官方一键脚本——发布 `latest-linux-x64.AppImage` 后，用户 `chmod +x` 直接双击运行；如需全局安装走 `AppImageLauncher` 或 `appimaged`。

## 前置条件

- 部署机对 `root@119.45.252.25` 有**免密 SSH**。
- 打包机有 `pnpm >= 9`、`node >= 22.19`（与 `apps/desktop/package.json` 的 engines 一致）。
- macOS 同时支持 arm64 与 x64 打包（同一台机）；Linux AppImage 跨平台直接打。
- **首次运行 electron-builder 会下载** Electron runtime 与 NSIS 工具链（合计 ~150 MB），CI 缓存里要保留 `~/.electron-builder/cache/`。

## 发布后验证

```bash
# 1. latest.json 在 nginx 上 200
curl -fsS http://119.45.252.25:18080/releases/latest.json

# 2. 软链全部指向真实产物
ssh root@119.45.252.25 'ls -la /var/lib/dsh-ops/releases/latest-*'

# 3. mac dmg 拉下来试挂载
curl -fsS -o /tmp/test.dmg http://119.45.252.25:18080/releases/latest-mac-arm64.dmg
hdiutil attach -readonly /tmp/test.dmg
ls "/Volumes/DeepSeek Harness/"

# 4. Windows exe 头 4 字节应是 'MZ'
curl -fsS -o /tmp/test.exe http://119.45.252.25:18080/releases/latest-win-x64.exe
xxd /tmp/test.exe | head -1

# 5. AppImage 头 4 字节应是 ELF magic
curl -fsS -o /tmp/test.AppImage http://119.45.252.25:18080/releases/latest-linux-x64.AppImage
xxd /tmp/test.AppImage | head -1

# 6. COS 同步（如果启用）
curl -fsS https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/latest.json

# 7. 应用启动后能连到 dsh-ops（端到端）
#    安装后启动 → Settings → baseUrl 是 http://119.45.252.25:18080/ →
#    点 Probe backend → 返回 model list
```

## 回滚

桌面客户端**没有回滚**——发布就是新版本覆盖旧产物 + 软链指向。如果某个版本有严重问题：

1. 重新跑一次 `package-release.sh` + `publish-client-release.sh`，打 patch 版本号（`0.3.0` → `0.3.1`）。
2. 或者：把软链指回旧文件：`ssh root@119.45.252.25 'cd /var/lib/dsh-ops/releases && ln -sf DeepSeek Harness-0.2.x-arm64.dmg latest-mac-arm64.dmg'`。
3. 用户的客户端 stub update-checker 不主动拉取，所以"回滚"完全靠用户手动重装——这是预期行为，等 dsh-ops 真暴露 `/releases/` 元数据后再做。

## 注意事项（勿再踩）

- **package.json 的 `name` 必须保持 `@deepseek-harness/desktop`**：macOS NSIS 的 uninstaller 路径里包含 `electron.appname`（基于 package.json name），改名字会让 install-win.bat 的 legacy path 失效。
- **Windows 旧 uninstaller 路径**有两个：`%LOCALAPPDATA%\Programs\DeepSeek Harness\`（新）和 `%LOCALAPPDATA%\Programs\@deepseek-harnessdesktop\`（my-agents 旧）。install-win.bat 会同时清这两个。
- **macOS Gatekeeper quarantine**：DMG 是 `curl` 下载的话一定会带 `com.apple.quarantine` xattr；install-mac.sh 必跑 `xattr -dr`，**不要去掉这一步**。
- **Code signing**：当前环境无 Apple Developer ID 与 Windows 代码签名证书，所以产物是 ad-hoc / 未签名。**正式公开分发前必须**：
  - macOS：Developer ID Application 证书 + `notarize` 步骤（electron-builder `mac.notarize: true` + keychain profile）。
  - Windows：EV 或普通代码签名证书 + electron-builder `win.certificateFile` + `certificatePassword`。
  - 没有这两步前，外部用户走 `install-mac.sh` / `install-win.bat` 才会**自动**绕过 Gatekeeper / SmartScreen；下载页面直链 .dmg 会触发系统警告。
- **`product-config.json` 一定先想好 baseUrl 再打包**：bake-in 的 URL 不能改；如果要给同一个构建切到 staging/生产后端，只能重打。
- **rsync 一定要包含 `scripts/install-*.sh|*`**：publish-client-release.sh 自动带上，但手抄命令时容易漏——install-mac.sh 与 install-win.bat 是软链指向 `latest-*` 之外的可独立下载脚本。
- **不要给 publish-client-release.sh 传 `--skip-cos` 之前先问要不要**：COS 是国内 HTTPS 主下载通道，运营依赖它发博客下载按钮；跳过会让运营侧发布会卡住。
- **CI 不能复用的 release/ 目录**：mac-arm64 + mac-x64 + Linux + Windows 一起打，单机耗时 ~3-5 分钟；并发跑需要不同 worker（同一 release/ 目录会被覆盖）。
- **apps/desktop/dist 是构建产物**：会被 git 忽略；如要回看某个产物，请去 release/ 而不是 dist/。
- **更新检查 stub**：当前 `update-checker.ts` 永远返回 `up-to-date`，所以 latest.json 上传后**应用不会自动拉**——需要用户手动重装。这是 PR 3 阶段决定，等 dsh-ops 真有 releases 元数据后再启用。