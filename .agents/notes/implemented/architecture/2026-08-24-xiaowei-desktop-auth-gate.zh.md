# Agent Note: Xiaowei 桌面渲染入口与 auth gate 架构

Status: implemented

[English](2026-08-24-xiaowei-desktop-auth-gate.md) | 中文

## 问题

xiaowei PR 2 已经把多用户后端、桌面 auth IPC 桥接、credential-store v3 的 token 持久化、ApiClient 的 bearer 注入都落地了。但是渲染入口的 `apps/desktop/src/renderer/index.html` 仍然指向旧的 `app.tsx` HashRouter shell — 六个页面（`HomePanel`、`HistoryPanel`、`AssistantPage`、`SettingsPage`、`ApprovalQueue`，外加之前就存在的 `tasks` 和 `approvals` tab 内容），再叠一个对 `WorkbenchApi` 的全局增强。PR 1 step D 写好的 Cordis 入口 `main.new.tsx` — `bootRenderer` + `useAuthStore` + `SignInCard` 覆盖层 — 虽然已经提交到树里，但实际上根本没被加载。在 `index.html` 切换之前，xiaowei 的 auth 流程根本没有可见的表面：没有 `SignInCard` 渲染，没有 `bindAuthStore` 的 IPC 订阅，signed-in 时不会引导 Cordis，主进程发出的「auth state broadcast」只会送到一个根本没订阅的渲染进程。

紧随其后的验收问题是：入口切换之后，怎么证明 gate 真的挂载上来了？Vitest 已经覆盖了 `CredentialStore` 和 `ApiClient.setToken`；typecheck 覆盖了 `AuthState` 判别联合和 IPC 的 Zod schema。但两者都不能证明渲染进程真的启动了、SignInCard 真的挂载到 `.signin-gate` 里了、`getAuthState()` 真的从 preload 桥一路回到 credential-store 的实时读。已有的桌面探针（`desktop-boot-probe.mjs`、`desktop-acceptance.mjs`）都连的是 Electron 的 CDP 端点，但探的是旧的 app shell。没有任何 CDP 探针专门驱动 auth-gate 的契约。

## 决策

把 `apps/desktop/src/renderer/index.html` 里 Vite 的模块入口从 `./main.tsx` 切到 `./main.new.tsx`。旧的 `main.tsx` 仍然留在树里 — Vite alias 保持有效，方便偶发的 dev 调试；线上应用加载的是 Cordis 入口。

`main.new.tsx` 同时只持有两个互斥挂载之一 — `.signin-gate` 的 React 根节点（只有 SignInCard）或者 Cordis host — 在挂下一个之前先把当前这个 unmount 掉。两个挂载共享 `#root`（一个已经断言为非空的 `HTMLDivElement`）。auth store 的订阅在 boot 时跑一次：当 `useAuthStore.state.signedIn` 翻转时触发交换。同一个 subscriber 也处理冷启动时 credential 已经包含有效 `sessionToken` 的情况 — `bindAuthStore()` 通过 `getAuthState()` 读一次，要么挂载 gate（signed-out）要么挂载 Cordis host（signed-in）。主进程发来的 auth 广播让两个窗口保持一致：`IpcChannels.AuthStateEvent` 扇出到每个 BrowserWindow 的 webContents，Zustand store 通过订阅的 listener 更新。

`container` 在做完非空断言后被捕获进一个 `const: HTMLDivElement`，而不是直接用 `document.getElementById('root')` 的结果。TypeScript 在闭包（`showSignInGate`、`showXiaowei`）跨越 `await` 边界后会丢失「非空」的窄化结果，因为源绑定在原理上可能被两个 await 之间的代码重新赋值。捕获模式保证窄化后的类型能活着进 async 函数体，不用每个闭包都重新断言或重新查 DOM。同一个 `#root` 元素被两个挂载复用；每次挂载都负责在下一个挂上来之前清理干净。

验收通过 Chrome DevTools Protocol 来驱动，而不是合成的 DOM 测试。`apps/desktop/desktop-auth-gate.mjs` 连上一个以 `--remote-debugging-port` 启动的 Electron 渲染端点，等四秒让 auth store 稳定下来，然后探：

1. `[data-testid="signin-gate"]` 包着一个 `.signin-card[data-mode="signed-out"]`，同时挂着 Sign-in / Sign-up 两个 tab，submit 按钮文案是 "Sign in"
2. `window.workbenchApi` 暴露了全部 16 个桥接 key（10 个基线 + 6 个 auth：`getAuthState`、`requestEmailCode`、`signIn`、`signUp`、`signOut`、`subscribeAuthState`）
3. `api.getAuthState()` 完成 preload → main → `CredentialStore.authState()` 的端到端往返，safeStorage 为空时返回 `{ signedIn: false }`
4. `api.requestEmailCode({ email })` 通过 IPC 抵达主进程；当配置的 loopback baseUrl 上没有 xiaowei 后端在跑时，返回 `HTTP_404` 是预期的结果 — 这一步验证的是 IPC 通道，不是 wire 协议本身
5. 探针跑完之后 gate 仍然挂载，没有意外的 sign-in 状态变更

探针是无 key 的：只需要 Electron + 构建出来的 dist，不需要后端。第 1-3 步和第 5 步都是纯渲染端断言；第 4 步在 IPC 层断裂时会大声失败，但对后端缺失宽容。这正符合测试策略里「keyless snapshot」的形态 — 不依赖 `DEEPSEEK_API_KEY`，在 macOS 和 Linux 上行为一致，断言可见的 DOM 和桥接表面。

## 候选方案

**把 SignInCard 内联到 Cordis slot 树里，而不是用一个 sibling overlay。** Cordis 的 UI 插件假设一个 slot 驱动的布局（sidebar / workspace / conversation / settings），而 SignInCard 有自己的数据流（只读 `useAuthStore`，不消费 Cordis 服务）。把它挂成 `ctx.uiRenderer.mount()` 的组件就得声明它根本不需要的 slot，并且 Cordis boot 一旦失败 gate 就渲染不出来了。overlay 让 auth 完全独立于宿主插件图：就算 `bootRenderer(container, api, baseUrl)` 抛了，gate 通过 `catch` 兜底照常渲染 SignInCard。

**用 Vitest JSDOM 探。** JSDOM 不实现 `BroadcastChannel` 走 IPC，Electron 的 `safeStorage` mock 要在模块级 monkey-patch，auth-gate 挂载摸的是 `document.getElementById('root')`，而这玩意儿只在真正的 document 里存在。单元测试的覆盖面已经直接打到 credential store 和 API client；CDP 探针补的是单元测试打不到的 — 真实的挂载、IPC 扇出订阅、React commit 之后的渲染端状态。

**用旧的 `main.tsx` 入口再加一个内联的 `<SignInCard />` 路由。** 旧的 shell 是 6 页 HashRouter；给它加 auth gate 就得拦截每个路由套一个 wrapper 组件，再用 React Router 的 outlet 把 gate 穿过去。Cordis 入口已经把 shell 整片替换掉；一个半重建的 shell 会带着两套导航模型，最终渲染端在 xiaowei bundle 下根本启不起来。干脆的入口切换赢了。

**用一个真的 xiaowei 后端跑 CDP 探针。** 探针的目的就是验证渲染端表面 — DOM 挂载、IPC 桥、auth-state 投影。一个真的后端会引入第二个变数（DSH_HOME、bootstrap 配置、SMTP transport、identity SQLite WAL），各有各的失败模式。第 4 步拿到的 HTTP_404 本身就已经是「IPC 通道抵达 `ApiClient.call('account.emailCode', ...)`」的信号。后端集成归 `sanity-account-signup.mjs`，不属于桌面 gate 探针的活儿。

**保留旧 `main.tsx` 当 dev 入口、只在生产切。** dev（`pnpm dev:renderer`）和生产（`npm run start`）走的是同一条 boot 路径。Vite 直接服务 `index.html`；script tag 指向哪个文件由我们定。一个入口，一个决定。

## 影响

桌面渲染端现在就是 Cordis 入口 — `app.tsx` 和六个旧页面留在树里但不再被加载。auth gate 是用户看到的第一印象：safeStorage 为空的冷启动渲染 SignInCard；带持久化 bearer 的冷启动渲染 Cordis shell（workspace 选择器、sidebar、conversation）。sign-out 拆掉 Cordis host 重挂 gate；sign-in 反过来。主进程的 IPC 广播让两个窗口保持同步。

CDP 探针是 CI 里一个无 key 的验收门槛。当 `sanity-account-signup.mjs` 和 `sanity-wallet-quota.mjs` 后续为 wallet / model-keys 步骤落地时，auth-gate 探针将成为前置条件（得先看到 gate 才能去试真的 signup）。渲染端入口是单向的 — `main.tsx` 和 `main.new.tsx` 之间没有 A/B。删掉旧的 `main.tsx` 是单独的清理动作，不在这次变更里。

`.signin-gate` overlay 挂载拥有 auth gate 的生命周期，但它依赖 `useAuthStore` 在 boot 时处在一个自洽的状态。如果 `bindAuthStore()` 失败（比如 `getAuthState` IPC 抛了），subscriber 就永远接不上，渲染端永远停在 gate 上。当前的实现是在订阅之前先 `await bindAuthStore()`；未来给 Cordis shell 加 sign-out 兜底时也要保留这个顺序。