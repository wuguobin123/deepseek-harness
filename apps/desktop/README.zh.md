# 小薇 — 桌面客户端

[English](README.md) | 中文

dsh-ops 部署的 Electron 桌面客户端。客户端使用与 dsh Web 前端（`@deepseek-ai/dsh-host-apiproxy`）相同的 RPC 信封，因此两个界面可以在同一后端上互换。

## 目标

- **main**、**preload** 和 **renderer** 之间实行严格进程隔离。
- Renderer 不能直接通过 `fetch` 访问后端；main 进程拥有所有 RPC POST、SSE 订阅方和 IPC 事件分发。
- Renderer 不能打开任意 URL；唯一的外部导航是用户通过 main 显式执行「打开更新下载」。
- 严格 CSP、禁止远程导航、禁止新窗口、禁用 `nodeIntegration`。
- 全面使用严格 TypeScript，renderer 使用 React + Zustand，单元测试使用 Vitest。

## 产品品牌

桌面端组合拥有小薇产品身份。它的 renderer 插件使用小薇标志填充共享侧边栏和对话品牌 slot，打包应用、浏览器和原生窗口标题使用「小薇」。Electron Builder 将 `features/brand/xiaowei-logo.png` 转换为 macOS、Windows 和 Linux 的原生应用及安装器图标。通用 DSH 客户端保留由各自构建选择的品牌。

桌面端的 Session 主体仅提供对话视图，不注册通用 Web 客户端中的可选「轨迹」Tab。

## 执行环境

全新安装默认使用**本机**环境。main 进程会在操作系统分配的 `127.0.0.1` 端口监管一个 `xiaowei-local` Host。在该环境中添加 Workspace 时，桌面端只把所选目录的规范路径传给回环 Host 的 `workspace.create`，不会枚举、编码、上传或复制该目录，因此不受云端副本文件大小限制。外部修改与 Agent 编辑都作用于同一个源目录。

**云端**是一个显式的替代环境。在该环境中添加 Workspace 时，桌面端会保留有界的 `workspace.importDirectory` 流程，并创建一份独立的账号私有副本；后续本机修改不会自动同步。Session、Workspace id、事件流和产物读取始终归属于创建它们的环境。切换环境时，桌面端会中止旧事件流，并让 renderer 针对所选 Host 重新加载。

本机 Host 会把模型配置、凭证、Session、元数据和已安装 Skill 保存在 Electron 应用数据目录下。对话中经过批准的 Skill 安装只会写入该本机 Skill 根目录。目录不会作为云端 Workspace 上传，但用户有意加入模型请求的内容仍会发送给本机配置的模型提供方。本机模式不会静默使用云端账号钱包。

「设置 → 技能」列出正式桌面运行时中安装的完整 Skill 目录。「安装 Skill 目录」会打开原生目录选择器；主进程校验嵌套普通文件并以原子方式复制到 `<userData>/local-runtime/skills`，既不向渲染进程暴露源路径或目标路径，也不上传目录。已有不同内容时只报告冲突，不会覆盖。该清单表示设备上的安装状态，并不证明某个 Session 已加载 Skill；有效条目继续使用现有 `/<skill-name>` 调用约定。

## 布局

```
apps/desktop/
├── package.json          # Electron + Vite + Vitest scripts
├── tsconfig.json         # Renderer/Preload TS config
├── tsconfig.node.json    # Main process TS config
├── vite.config.ts        # Renderer build + Vitest config
├── electron-builder.yml  # Packaging (dmg / AppImage / nsis)
├── product-config.json   # Default apiBaseUrl baked into the binary
└── src/
    ├── shared/contracts.ts   # dsh RPC + Mux/Host stream envelope schemas
    ├── main/                 # Electron main process
    │   ├── index.ts          # App lifecycle + secure BrowserWindow
    │   ├── api-client.ts     # RPC client over POST /api/<method>
    │   ├── sse-proxy.ts      # WebSocket downlink + heartbeat → typed IPC fan-out
    │   ├── credential-store.ts # connection preferences + encrypted account session
    │   ├── ipc-handlers.ts   # Typed ipcMain handlers
    │   ├── local-skill-directory.ts # Bounded, atomic local Skill bundle store
    │   └── update-checker.ts # Same-origin release-manifest polling
    ├── preload/index.ts      # contextBridge.exposeInMainWorld('workbenchApi')
    └── renderer/             # React + HashRouter
        ├── main.tsx
        ├── app.tsx
        ├── api.ts            # typed wrappers over window.workbenchApi
        ├── stores/session.ts # baseUrl slice
        └── features/
            ├── home/         # Sessions list + new-session button
            ├── assistant/    # Thread + composer, MuxFrame subscription
            ├── tasks/        # session/jobs aggregator
            ├── approvals/    # approval/requested inbox + decide
            ├── history/      # session.search form
            └── settings/     # baseUrl field + host.describe probe
```

## Preload 约定

```ts
window.workbenchApi.request(method, payload)            // POST /api/<method>
window.workbenchApi.subscribeMux(listener)              // SSE → MuxFrame
window.workbenchApi.subscribeHost(listener)             // SSE → HostFrame
window.workbenchApi.respond(rpcId, value, error?)       // POST /api/respond
window.workbenchApi.getSession()                        // { baseUrl, environment, version }
window.workbenchApi.updateSession({ baseUrl, environment })
window.workbenchApi.checkAppUpdate()                    // GET /releases/latest.json
window.workbenchApi.openAppUpdateDownload()             // validated shell.openExternal
```

不会公开任何其他内容：桥接对象中没有 `ipcRenderer`、`require`、`process`。

main 进程在两条下行链路上发送协议 ping 帧。缺少 pong 会终止该连接代次；随后，共享连接控制器会同时重新打开 mux 和 host，并重新拉取所有打开的会话。仅缺少应用事件绝不会把健康 workspace 标记为已断开。

## 页面

| 路由 | 界面 |
|---|---|
| `/` | 首页：会话列表和新建会话按钮 |
| `/assistant/:sessionId` | 助手：对话和输入框；Mux 订阅 |
| `/tasks` | 任务：所有会话的 `session/jobs` 聚合器 |
| `/approvals` | 批准：待处理的 `approval/requested` 和决定操作 |
| `/history` | 历史记录：`session.search` 结果 |
| `/settings` | 设置：`baseUrl` 字段和 `host.describe` 探测 |

登录后，侧边栏底部显示当前用户、MiniMax 额度，以及右对齐的客户端更新图标。用户主体打开「设置 → 账户」，更新图标则保持为独立操作。退出登录只在「账户」部分提供。注册通过 `account.wallet.grantWelcomeBonus` 发放配置的一次性 20 CNY 额度。

## 安装／构建／测试

```bash
cd apps/desktop
pnpm install
pnpm run typecheck
pnpm run test           # Vitest
pnpm run build          # tsc emits main + Vite emits renderer
pnpm run start          # launches Electron against the built renderer

# Point the build at a different backend, then package:
WORKBENCH_API_BASE_URL=https://assistant.example.com pnpm run package:mac
```

## 打包

`electron-builder` 生成：

- macOS Apple Silicon：`pnpm run package:mac`
- macOS Intel：`pnpm run package:mac:x64`
- Linux `.AppImage`：`pnpm run package:linux`
- Windows `.exe`（NSIS）：`pnpm run package:win`

打包前，preload 会捆绑为单个 CommonJS 文件，因为 Electron 沙箱 preload 无法加载任意本地模块。打包流程还会部署自包含的 `local-runtime` 资源，供受监管的本机 Host 使用；它的 Session、设置、凭证和已安装 Skill 都保留在 Electron 应用数据目录中。本地产物使用临时签名；公开发布仍需 Apple Developer ID 证书和公证。DMG 名称为 `小薇-<version>-arm64.dmg`。

在 Apple Silicon 上，未签名 DMG 会触发 Gatekeeper 隔离。内部部署使用：

```sh
xattr -dr com.apple.quarantine "/Applications/小薇.app"
```

## 后端约定

桌面客户端使用 `@deepseek-ai/dsh-host-apiproxy` 定义的 dsh RPC 信封。协议格式与 dsh Web 前端共享；见 `packages/host/apiproxy/src/api/rpc.schema.ts` 和 `packages/host/apiproxy/src/api/events.ts`。Renderer 只访问 `src/renderer/api.ts` 中的类型化包装层，绝不会自行构造信封。

默认后端为 `http://119.45.252.25:18080/`（dsh-ops nginx → apiproxy 链路）。构建时使用 `WORKBENCH_API_BASE_URL` 覆盖，或在运行时通过「设置」页面更改。

## 安全检查表

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- CSP 禁止 `default-src 'self'`；没有远程脚本
- 阻止 `will-navigate` 和 `new-window` 事件
- Preload 只公开 `window.workbenchApi`
- Renderer 不能通过 `fetch` 访问 API；请求头（如有）和 `baseUrl` 由 main 拥有
- `shell.openExternal` 仅允许应用更新下载路径

## 测试

```bash
pnpm run test           # Vitest unit tests (preload, account footer, updater)
```

## 产品部署边界

DMG 同时包含桌面客户端和本机 Host 运行时。本机模式把模型配置、凭证、Session、元数据和已安装 Skill 保存在 Electron 应用数据目录中；云端模式使用 dsh-ops 后端提供账号所属的模型访问、连接器、工作流和审计数据。打包前将 `WORKBENCH_API_BASE_URL` 配置为云端部署的 HTTPS URL。见 [`docs/ops/acceptance-report.md`](../../docs/ops/acceptance-report.zh.md)。
