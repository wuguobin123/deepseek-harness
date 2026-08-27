# @deepseek-ai/dsh-client-ui-theme

[English](README.md) | 中文

主题插件：基于 --dsw-* token 基础样式表（静态尺度 + 别名语义层）的 ThemeRuntime。发布的客户端与 Host 引导代码直接以 `light` 启动；产品不注册 Appearance 设置行或 Host theme 设置，并忽略遗留的 `ui-theme.preference` 与桌面端 `dsh.theme` 值。该服务通过 `theme/change` 发布不可变的 `ThemeSnapshot`，且绝不接触 DOM：ui-layout 的展示转换器会应用解析后的快照（`html { color-scheme }`、`body[data-ds-dark-theme]`，以及主题的别名 token 内联变量）。编程式 `setTheme` 与第三方主题注册仍作为进程内扩展 API 保留，其中包括通过 `prefers-color-scheme` 解析 `system`。[固定产品展示决策](../../../.agents/notes/implemented/simplification/2026-08-24-fixed-chinese-light-client.zh.md)负责规定产品默认值和被移除的设置。

当 Host 组合包含 HTTP 服务器时，Host 侧紧接 `<body>` 起始标签注入同步浅色引导代码，并在外壳加载页面渲染前设置 `color-scheme` 和清除 `body[data-ds-dark-theme]`。不含 HTTP 服务器的组合不受影响，插件树激活后，ThemeRuntime 与 ui-layout 仍分别是客户端状态和后续 DOM 更新的权威来源。

`src/styles/` 下有五张样式表，由 ui-theme 的动态客户端 entry 依次导入：`base.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css` 与 `shiki.css`。客户端 bundle 将其编译并注入为插件持有的全局样式，因此卸载与 HMR 会随 ui-theme 一同移除这些样式，而不会把主题 CSS 留在静态 Web 外壳中。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消费方，必须排在声明这些 token 的 `design-platform.css` 之后。

滚动条重新绑定约定：`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 与 `--dsh-scrollbar-thumb-hover` 绑定到 l1（基础表面）token，两条渲染路径都读取这一组变量。高层级表面（菜单、浮层、对话框）在自己的容器上设置 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 与 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)`；一次重新绑定即可为引擎实际走的那条路径换色。这组变量的另一个合法目标是 `transparent`，即完全不绘制滑块——[ui-sidebar](../ui-sidebar/README.zh.md) 在指针不在栏内时就这样重新绑定自己的列。绑回 l1 那组不算重新绑定，它只是重述基础表面的默认值。`--dsh-scrollbar-width` 镜像 WebKit 滚动条的布局宽度，供需要与占布局宽度的滚动条对齐的表面使用——[ui-conversation](../ui-conversation/README.zh.md) 用它作为覆盖 composer 座位 `right` 偏移——scrollbar-styles 规格把它与镜像规则及消费者配对检查。

两条路径在构造上互斥。`scrollbar-width`／`scrollbar-color` 写在 `@supports not selector(::-webkit-scrollbar)` 之内，因为这两个属性中的任一个只要取非 `auto` 值，Chromium 与 Safari 就会丢弃该元素上的全部 `::-webkit-scrollbar*` 规则，`::-webkit-scrollbar-thumb:hover` 也在其中——若无条件地同时声明，`--dsh-scrollbar-thumb-hover` 在任何引擎上都不会被渲染。因此 Firefox 走标准属性，WebKit 系引擎走伪元素，hover token 只经由伪元素这条路径渲染。相关原理与实测计算值见[滚动条 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md)。

## 模型体验

无。主题服务管理浏览器展示状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **第三方主题是表层，不是产品**：注册主题意味着覆盖同名别名变量；目前不会验证一组覆盖是否完整。
- **token 样式表是颜色值的唯一权威来源**：会有意不补入 cssdesign 中缺失的值（例如设计中的 #4176E6 标签页蓝色）；一律采用最接近的语义 token。设计负责人批准的新增值是例外：须在同一变更中以一个静态尺度层级与一个语义别名的形式进入（`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`）。
