# Agent Note: 设置不提供 agent preset 管理

Status: implemented

[English](2026-08-24-settings-omits-agent-preset-management.md) | 中文

## Problem

设置导航曾提供独立的 Agent 预设页面，用于复制、删除、浏览和选择 preset 组装。这让面向专家的文件系统创作流程与常规账户、模型配置一样，成为设置中的常驻入口。

该页面还独占两套展示机制。名单卡片会测量并截断任意长度的 preset 描述，同时保留完整的无障碍文本；创造模式入口会跨页面暂存 `cordis` preset，并用兼容减少动态效果偏好的引导动画提示用户。两套机制都增加了状态、CSS、测试和维护成本，只为维持一个设置入口。

## Decision

交付的客户端不为 Agent 预设注册 `settings.section` 条目。`@deepseek-ai/dsh-client-ui-agent-preset` 保留 General 中为后续会话选择默认 preset 的行，以及会话标题旁的只读标签；不再交付名单卡片页、复制/删除/查看/位置操作、创造模式入口或跨页面引导动画。[新建会话页不显示 preset 选择器](2026-08-25-new-session-page-omits-preset-selector.zh.md)。

preset 创作仍可通过 agent-preset 服务、宿主 API、面向 CLI 的工作流和 preset 文件完成。删除设置页不会改变 preset 发现、挂载、会话选择、wire 方法或 `agent-presets` 设置命名空间。

## Alternatives considered

**只在 Xiaowei 中隐藏该分区。** 这会让同一个共享客户端插件保留两套产品行为，并让管理代码与测试继续进入每个构建。该产品决策针对设置信息架构，而不是单个 profile。

**保留只读 preset 浏览器。** 查看器仍会为专家流程占据一个导航入口，却没有让该入口有用的操作。随附 preset 组装和用户创作文件仍可通过它们所属的文件系统与 agent 工作流访问。

**停止注册分区但保留休眠实现。** 没有受支持入口的组件、locale 字符串、控制器和 E2E fixture 仍会参与编译。删除实现后，注册测试和生成的客户端目录都会明确记录该入口不存在。

## Consequences

用户不能再从设置中复制、删除、浏览 preset 或打开其目录，设置也不再提供创造模式创作跳转。保留的 General 选择器仍会隐藏 discovery 标记为 broken 的 preset，因此客户端无法为会话设置不可加载的默认组装。

被删除页面的描述截断和引导动画一并消失，不提升为通用能力。如果以后重新引入独立的 preset 管理流程，必须先定义其位置与安全模型，再恢复无障碍溢出处理、减少动态效果行为、破坏性操作确认，以及覆盖该流程的端到端创作测试。

包测试断言该插件只向设置贡献 General 行。生成的客户端 slot 目录不再包含 Agent preset occupant，设置外壳 E2E 快照断言该导航入口不存在。专用 Web 创作 E2E 及其快照也被删除，因为该浏览器流程不再受支持。
