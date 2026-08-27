# Agent Note: 桌面端旧样式表沉入 web GUI 之下的层叠层

Status: implemented

[English](2026-08-24-desktop-legacy-styles-cascade-layer.md) | 中文

## Problem

桌面渲染进程把 Cordis web GUI（自带 `--dsw-*` 设计体系、CSS Modules）挂载进 `apps/desktop/src/renderer/styles.css` 用裸元素选择器造型的同一棵树。这些全局规则既压过又渗入 GUI 的单类名 module 规则：`button:hover`（元素 + 伪类）的优先级高于 module 的单个类名，于是悬停的插件设置卡片头被漆成深藏青（`--surface-hover`），深色文字几乎不可读；而 `button { height: 32px }`——module 从未声明的属性——把卡片的两行头部裁到 32px。桌面壳里每个 GUI 按钮都继承了同样的深色悬停，插件面板只是问题被报告的地方。

## Decision

整份旧样式表放进 `@layer workbench`（`apps/desktop/src/renderer/styles.css`）：层内规则无论优先级高低都输给未分层规则，于是 GUI module 类在它们声明过的属性上一律胜出，而桌面自己的基于类名的组件——全部在同一层内——内部优先级关系不变。层无法修复的两处渗漏改为显式声明：`button { height: 32px }` 改为 `min-height: 32px`，使其无法裁剪更高的内容；插件卡片头声明 `white-space: normal` 以对抗继承来的 `nowrap`；字段级重置按钮声明 `min-height: 0`，使按钮基础规则不能撑高它所在的徽标行。

## Alternatives considered

- **把元素选择器限定到登录闸和用户菜单根节点**——否决：桌面端的槽位填充组件（侧边栏、assistant 面板）在 Cordis 树内渲染裸 `<button>`/`<input>` 并依赖这些全局规则，限定范围会让它们失去样式。
- **只做逐组件的防御性声明**——否决：只修好被报告的面板，其他每个 GUI 按钮的深色悬停依旧，且每个未声明属性的渗漏仍是打地鼠。
- **把裸 `button` 选择器换成桌面特性共用的类名**——长期看是正确的卫生措施，但为修一个样式回归要动约三十处正在进行中的渲染层文件；层叠层用两行就达到了同样的隔离。

## Consequences

- 桌面壳内每个 GUI 组件声明过的属性现在都按设计渲染——悬停背景、边框和字体在整个应用范围内修复，而不只是插件面板。
- 未声明属性的渗漏在构造上仍可能发生：GUI module 没有声明的地方，层内全局规则依然生效。每个被发现的案例都是一行局部声明，本次随附的两处即为例证。
- 桌面内部样式不受影响：规则只相对 GUI 产物改变了层级，彼此之间关系不变。

## Testing

- `pnpm --filter @deepseek-harness/desktop run build:renderer` 可打包分层后的样式表。
- `npx vitest run packages/client/ui-settings-plugins`——组件套件（`section.client.spec.tsx`，26 个测试）通过；`apply.client.spec.ts` 的失败先于本改动存在于 xiaowei 分支（`scripts/test-invariants.ts` 的 `FiberState` 解析问题），把本次编辑 stash 后照样复现。
- 真实 Electron 壳验证了 Plugins 标签在鼠标悬停前后的状态：两种状态下 `background-color` 都保持透明，激活下划线保持可见。

## Related

- [桌面端登录后用户菜单](../architecture/2026-08-24-desktop-post-login-user-menu.zh.md)——同一样式表服务的兄弟根节点壳层
