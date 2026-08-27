# Agent Note: 新建会话页不显示 preset 选择器

Status: implemented

[English](2026-08-25-new-session-page-omits-preset-selector.md) | 中文

## Problem

新建会话页在工作区选择器旁放置了 agent preset 选择器。这个一次性选择需要专用 slot、组件、名单 store 和暂存生命周期，并要等空白会话出现后再调用 `agentPreset.select`。它重复了 General 中的持久设置，而多数用户希望部署一致决定这项选择。

## Decision

新建会话页只渲染工作区选择器，并在启动会话时使用宿主的有效默认 preset。`@deepseek-ai/dsh-client-ui-agent-preset` 不注册 `conversation.hero.agentPreset`，`dsh-client-ui-conversation` 也不声明或渲染该 slot。

General 设置行仍是为后续会话选择默认值的持久方式。会话标题仍保留只读 preset 标签，宿主 API、落账的 `agent-preset/selected` 事件和空白会话重组行为仍可供非 hero 调用方使用。

## Alternatives considered

**用 CSS 隐藏选择器。** 不可访问的控件、slot、暂存 store、网络读取和测试仍会活跃。删除注册与声明后，产品行为和客户端约定才保持一致。

**把选择器换成默认值静态标签。** 标签会增加模式信息，却不提供操作。会话标题已会在这项信息有用时报告 preset。

**删除所有 preset UI。** General 行仍提供有用的持久部署偏好，会话标题则说明恢复会话的组装。删除这两处会丢失上下文，而不只是删除按会话覆盖。

## Consequences

用户无法从 hero 为某个新会话单独覆盖 preset。如果希望后续会话使用其他 preset，需要在 General 设置中修改默认值。客户端不再拥有暂存 preset 选择或 hero preset slot，外部调用方仍可使用宿主的空白会话选择 API。

包测试断言只注册 General 行和会话标题标签。Web E2E 的 hero 快照只包含工作区选择器，并确认连接后的会话使用配置的 `standard` 默认值。生成的客户端目录不包含 `conversation.hero.agentPreset`。
