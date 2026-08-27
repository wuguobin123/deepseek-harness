# Agent Note: Desktop resolves its directory-flow surface from the baseUrl

Status: implemented

[English](2026-08-23-desktop-adaptive-directory-flow.md) | 中文

## Problem

Desktop（Electron）渲染进程静态打包唯一的目录流 surface，并无条件激活 **native** 版本，它驱动 `host.pickDirectory`——一个固定只允许 loopback 调用方的特权 RPC，在 **host 所在机器**的显示器上弹 OS 选择器。把 desktop 指向远程 host 后，"添加工作区"会以 `directory picker failed: forbidden` 失败（connection fence 的 403 响应体被当作 RPC 错误消息上浮）。即使越过 fence 也注定失败：systemd 下的远程 host 没有显示会话，`directory-picker-auto` 组成的是 browse 后端，根本没有 native 能力可调。web UI 没有这个失败模式，因为 host 会把配对的 client surface 作为 Loader 条目挂载（见[自适应默认](../feature/2026-07-29-directory-picker-adaptive-default.zh.md)）；desktop 的 boot 缺少等价解析——对所有部署形态硬接线同一个 surface。

## Decision

`bootRenderer` 接收配置的 `baseUrl`（每次 boot 经 preload 桥从 main 进程会话采样），通过 `apps/desktop/src/renderer/directory-flow.ts` 中的纯函数 `resolveDirectoryFlowSurface(baseUrl)` 每次 boot 解析一次 surface：loopback hostname（`localhost`、`[::1]`、任意 127/8）解析为 `native`，其余解析为 `browse`，无法解析的 baseUrl 失败到 `browse`——对任何可达远程 host 都可用的 surface。该规则镜像 host 侧解析器的第一条（loopback bind ⇒ 操作者在场）：loopback baseUrl 意味着 host 进程就跑在操作者本机，OS 选择器弹在操作者正在看的显示器上。远程 baseUrl 得到 browse surface，其 `host.listDirectory`/`host.createDirectory` RPC 对 trusted-host 调用方开放，不同于固定 loopback 的 `host.pickDirectory`。同一改动还修复了 desktop 的 `SlotMap` 漂移（`slots.d.ts` 把 `sidebar.workspaces.directoryFlow` 声明成 `list` 且漏了 hero 洞），对齐 ui-workspace 权威的带 owner 的 `single` 声明。

## Alternatives considered

- **复用 host 的条目挂载机制**——不可行：desktop 渲染进程没有 Loader，也没有 `/plugins` 模块供给；它的插件图是静态 Vite 产物，选择只能发生在 renderer 的 boot 胶水里。host 侧笔记中暂缓的按连接自适应，是从另一侧看到的同一问题。
- **先试 native，失败后回退 browse**——按 host 侧笔记已记录的理由否决：一个 bundle 装两个流程加上每次打开都白付一次注定失败的 RPC，而且固定 loopback 的 403 不是值得重试的暂时性错误。
- **新增 preload IPC 走 Electron 原生对话框**——对 loopback 场景体验更好（不经 host 绕一道 osascript），但现有 native surface 在该场景已经可用；只有当 host 往返被证明不稳定时再补。（移植阶段留下的两个未接线的 `features/directory-picker/` 组件正是这个预想，继续保持不接线。）
- **从 `dsh-client-connection` 导入 `isLoopbackHostname`**——该谓词自己的 docstring 把它钉为包内部；本地复制九行好过为单一调用方 widening 别的包的 API。

## Consequences

- 指向远程 host 的 desktop 得到应用内浏览对话框，不再是 403 错误对话框；loopback host 保持 OS 选择器，行为不变。
- 选择发生在 boot 时，与 host 每次 boot 解析一次的稳定性约定一致：在 Settings 里改 baseUrl 后，选择器在下一次 renderer boot 才采用新判定，不即时生效。
- 继承了 `ssh -L` 盲区：desktop 的 loopback baseUrl 实际是通往无头 host 的隧道时解析为 `native`，调用以后端的可重试错误对话框收场（host 组的是 browse）——与 host 侧解析器记录在案的同一限制。
- `slots.d.ts` 现在镜像权威约定，desktop typecheck 能抓住未来的漂移，而不是掩盖它。

## Testing

- `apps/desktop/tests/directory-flow.test.ts` 钉住 loopback／远程／不可解析三种解析结果。
- Desktop typecheck 与 `build:renderer` 覆盖 surface 导入接线；loopback 路径是此前已发布的行为。

## Related

- [Directory-picker 能力缝](../architecture/2026-07-28-directory-picker-capability-seam.zh.md)
- [目录选择器交互的自适应默认](../feature/2026-07-29-directory-picker-adaptive-default.zh.md)
- [小薇本机目录导入](../feature/2026-08-26-xiaowei-local-directory-import.zh.md) 以有界的本机副本导入取代了远程 Electron 的 `browse` 决策；loopback 和非 Electron surface 仍遵循本笔记。
