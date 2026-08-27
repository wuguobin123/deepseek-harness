# Agent Note: Xiaowei 组成 agent preset 平面

Status: implemented

[English](2026-08-24-xiaowei-agent-preset-composition.md) | 中文

## 问题

Desktop 渲染层挂载了与 WebUI 相同的 `ui-agent-preset` 插件，但 `xiaowei` profile 由 `dsh-base`、`dsh-headless` 与 `dsh-xiaowei` 组成，其中没有 `agent-presets` 服务。因此 `agentPreset.list` 返回了合法的“无名单”响应，设置区隐藏不可用内容，而已注册的导航项仍然可见。仅增加名单也不正确：base 层的模型可见插件仍会保持全局，preset 只能增加能力却不能移除能力。

## 决策

Xiaowei 组合包采用与 Web 组合包相同的[宿主平面与 agent 平面拆分](../architecture/2026-08-03-per-session-agent-presets.zh.md)，但不引入 Web 应用的启动逻辑、浏览器插件名单或服务器配置项。它禁用由随附 preset 组装所拥有的 base 模型可见配置项，插入以 `standard` 为组装默认值的 `@deepseek-ai/dsh-agent-presets`，并将该包声明为直接依赖。CLI profile 组合器发现名单配置项后会提供随附 preset 根目录，因此 WebUI 与 Desktop 通过 `agentPreset.list` 读取同一份实时名单。

## 测试

真实组装回归在关闭外部副作用的前提下引导 Xiaowei 组合包各层。测试断言宿主工具层为空、随附名单可用，且 `standard` 与 `minimal` agent 获得不同的作用域工具目录。

## 考虑过的替代方案

**在 Desktop 中显示空态消息。** 该设置区把无名单部署报告为不可用是正确行为。空态只能描述能力缺失，不能让 preset 选择真正工作。

**只插入 `agent-presets`。** 否决，因为 base 的模型可见配置项会保持全局。`minimal` 会话仍会保留完整的宿主工具目录，从而违背 preset 选择。

**把 `dsh-web-app` 叠加进 Xiaowei profile。** 否决，因为该组合包还拥有 Web 启动逻辑、浏览器插件名单、存储、连接、网关与服务器配置项，而 Xiaowei 已经用产品专属配置提供了这些内容。

## 后果

Xiaowei 会话由 preset 组装，不再继承一套进程级全局 agent 工具集。设置页、新建会话选择器与会话标签会反映同一份宿主名单。随附 preset 的人设会按现有的按会话人设规则遮蔽 Xiaowei 部署人设；产品专属默认人设需要由产品专属 preset 提供，而不是另建一套宿主级工具组装。
