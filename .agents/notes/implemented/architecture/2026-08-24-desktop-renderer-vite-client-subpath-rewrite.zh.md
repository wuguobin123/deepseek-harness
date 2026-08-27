# Agent Note: 桌面渲染端 vite /client 子路径改写

Status: implemented

[English](2026-08-24-desktop-renderer-vite-client-subpath-rewrite.md) | 中文

## 问题

`pnpm --filter @deepseek-harness/desktop start` 在 `Rollup failed to resolve import "@deepseek-ai/dsh-host-apiproxy/client"` 处失败。渲染端无法对生产 nginx 端点 `http://119.45.252.25:18080` 启动。

三个潜在问题叠加：

1. **缺失 workspace 依赖。** `apps/desktop/package.json` 的 `dependencies` 里完全没有 `@deepseek-ai/dsh-*` 依赖。Vite 经 包 `exports` 映射解析 `@deepseek-ai/dsh-host-apiproxy/client`； 包未链接进 `node_modules` 时该 import 不可解析。

2. **`/client` 子路径是 `__ModuleLoader__` 工厂而非 ESM。** `packages/client/tsdown.client.ts` 的 tsdown `clientBundle()` 预设把 `lib/client.js` 输出为 `window.__ModuleLoader__.load({id, factory})` —— 一个闭包， 其 `exports` 挂在内部 `module.exports` 上，但**不会**出现在 ESM 顶层。被服务的 web 运行时通过 cordis ModuleLoader （`packages/client/web/src/boot.ts:46-67`）消费这些产物，从 不当作静态 ESM import 读取。桌面渲染端在 `cordis-host.ts:28-64` 通过 `@deepseek-ai/dsh-*/client` 静态 import 30+ 包，vite/rolldown 无法静态解析 —— 该文件零 ESM 具名导出。

3. **`api.ts` 缺少 `artifact` 命名空间。** xiaowei PR 加了 `DocumentPreview.tsx`、`DocumentPreviewPanel.tsx`、 `HtmlPreviewRow.tsx`，三者都 `import { artifact } from '../../api'`， 但渲染端 api 命名空间未导出 `artifact` 对象以及 `ArtifactKind` / `ArtifactMediaType` / `ArtifactView` 类型。

## 决策

三处协调变更：

### 1. `apps/desktop/package.json` 加 workspace 依赖

```jsonc
"dependencies": {
  "@deepseek-ai/cordis": "workspace:^",
  "@deepseek-ai/dsh-client-connection": "workspace:^",
  "@deepseek-ai/dsh-host-apiproxy": "workspace:^",
  "@deepseek-ai/dsh-typert-registry": "workspace:^",
  ...
}
```

`cordis` 是插件框架依赖。`dsh-client-connection` 覆盖少数工具 类型 import（`SessionId`）。`dsh-host-apiproxy` 需要，因为 `transport.ts` 从其 `/client` 子路径 import `AbstractApiClient`。 `dsh-typert-registry` 覆盖 `cordis-host.ts:27` import 的 `TypertRegistry` 具名 class 导出。

### 2. Vite 插件把 `/client` 子路径改写为源码 TS

`vite.config.ts` 中 `enforce: 'pre'` 的 `resolveId` 插件匹配 `@deepseek-ai/dsh-{client,host,api}-*/client`，把每一处改写为 `<repo>/packages/<group>/<name>/src/client/index.ts`。Vite 接着 把 TypeScript 源码作为桌面 bundle 的一部分编译。

插件仅在 `src/client/index.ts` 存在时改写某子路径 —— `@deepseek-ai/dsh-host-apiproxy/client` 没有源码子路径（其 `/client` 在 `lib/types/fetch/client.js` 输出为 ESM），所以现有 包解析透明处理 apiproxy。

30+ 使用 `apply()` 的包（`client-ui-*`、`client-*`）都有 `src/client/index.ts`，都被改写。

### 3. 渲染端 `api.ts` 暴露 `artifact` 命名空间 + 类型

镜像 `packages/host/apiproxy/src/api/artifacts.ts:27-71`：
- `ArtifactKind = 'html' | 'slides' | 'doc' | 'sheet' | 'chart'`
- `ArtifactMediaType = 'text/html' | 'text/markdown' | 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'application/pdf'`
- `ArtifactSource` 带六个封闭的生产者标识（`tool-html` / `tool-slides` / `tool-doc` / `tool-sheet` / `tool-mermaid` / `tool-svg`）
- `ArtifactView` 带所有线字段
- `artifact.{list, read, remove}` 包装器复用现有 `call()` helper

品牌 cast 类型（host 包的 `ArtifactId = Branded<'ArtifactId'>`） 在渲染端边界变成 `string` —— 渲染端永远不需要该品牌做收窄。

### `client-connection` 的再导出

`packages/client/connection/src/client/index.ts` 从 `@deepseek-ai/dsh-host-apiproxy/api/*` 再导出 `hostFrameSchema`、`muxFrameSchema`、`serverRequestSchema`，让 适配 `ClientTransportHooks` 的渲染端消费者（例如桌面 IPC 桥） 无需深入 host 包图。本轮加了再导出但**未采用** ——  `apps/desktop/src/renderer/transport.ts` 继续从 `@deepseek-ai/dsh-host-apiproxy` 直接 import，因为 workspace 依赖让该路径可解析。再导出保留给未来偏好单 client-bundle import 的渲染端消费者用。

## 备选方案

- **桌面渲染端消费 `__ModuleLoader__`** —— 拒绝。被服务的 web 运行时的模块系统正是因为跨包模块表副作用（cordis DI 实体、 `require()` 注入、style 标签戳印）才存在；桌面壳只发一份静态 bundle，ModuleLoader 的主要收益（分层懒加载）不适用。强制桌面 通过 ModuleLoader 运行时意味着 30+ 个内联 `<script>` 求值， 桌面主进程还得引导 `window.__DSH_BOOT__` / `window.__ModuleLoader__` 全局。

- **加 `dsh-host-apiproxy` 和每个包输出一份 ESM 的 `client` 的 tsdown build** —— 拒绝。30 包 × 2 build = 60 份 build 配置 以及每包一个 schema 切分（工厂 vs ESM）。工厂 bundle 是 ModuleLoader 设计明确选定的形态。为桌面改 build 会污染被服务 web 的契约。

- **`cordis-host.ts` 改用相对源码路径 import 每个 `apply`** —— 拒绝。PR1 webUI parity 工作已经选定 `@deepseek-ai/dsh-*/client` 作为公共表面；改写 30+ 个 import 为相对路径会丢掉包边界并把桌面耦合到每包的源码布局。

- **用 vite 的 `alias.find` 函数替换** —— 拒绝。Rolldown 的 `resolveId` 插件才是正确工具 —— vite 用 `StringExpected` 拒掉 `alias.entries` 中函数形态的 `replacement`。

- **通过 `lib/index.js` 再导出 `apply` 与类型** —— `lib/index.js` 产物是 Cordis Loader 插件入口（服务端 apply 路径）， 不是浏览器友好的 ClientApply 路径。混着两条路径会让被服务 web 的 Cordis Loader 困惑 —— 它把 `lib/index.js` 读作插件注册。

## 影响

### 收益

- **桌面在生产 nginx 端点启动。** 完整 cordis 插件图 （`connection → runtime → settings → theme → ... → 30+ feature plugins → renderer`）在静态渲染 bundle 中激活； WebSocket `/api/events.mux` / `/api/events.host` 下行与 `POST /api/<method>` 一元 carrier 经桌面 IPC 桥路由到生产 nginx `http://119.45.252.25:18080`。

- **一份渲染端源码，无每包 fork。** Vite 插件匹配包命名约定； 增加第 31 个遵循相同 `src/client/index.ts` 约定的包不需要 vite config 改动。

- **桌面渲染端自给自足。** 直接对着仓库源码编译；ModuleLoader 运行时、`__DSH_BOOT__` 清单、cordis 插件加载器、worker-tunnel transport hook 全部在桌面壳跳过 —— 它们属于被服务 web 运行时。

- **渲染端类型保持准确。** `ArtifactView` / `ArtifactKind` / `ArtifactMediaType` 在 `api.ts` 与 host 线面对齐；未来 host 端新增（新的 mediaType 或 source）需要渲染端更新 + 渲染端 rebuild。

### 代价

- **Vite 插件必须理解包命名约定。** `client-*` / `host-*` / `api-*` workspace group 硬编码在正则里。改 group 名（例如 `client-ui-*` → `dsh-client-ui-*`）需要更新正则。

- **CSP / 字体警告。** 打包后的 webUI 自带 `data:font/woff2` URI，被桌面严格 CSP（`font-src 'self'`）拒绝。这是非致命 警告 —— 渲染端仍以回退字体绘制。本 PR 范围之外。

- **Bundle 体积。** 完整 webUI bundle 约 2.1MB minified （`dist/renderer/assets/index-*.js`）。本 PR 范围之外 —— 桌面渲染端启动不需要 code-split manualChunks 配置。

- **`tsdown.client.ts` 工厂形态不变。** 被服务 web 保留其 `__ModuleLoader__` 工厂 bundle 契约；桌面的源码改写是两面 间的单向不对称，由两者不同运行时模型正当化。

- **`packages/client/connection/src/client/index.ts` 再导出未 使用。** 本轮加的 `hostFrameSchema` / `muxFrameSchema` / `serverRequestSchema` 再导出尚未被消费（桌面 `transport.ts` 继续从 `@deepseek-ai/dsh-host-apiproxy` import）。保留给未来 渲染端消费者用；删它们会要求改桌面 transport import 对齐。