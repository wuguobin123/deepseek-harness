# Agent Note: 工作区选择保留新建会话的本地归属

Status: implemented

[English](2026-08-25-workspace-session-local-attachment.md) | 中文

## 问题

当工作区没有可在本地复用的空会话时，选择该工作区会在 Host 上创建会话，但客户端要等到后续工作区帧到达才会保存该会话的工作区归属和规范目录。于是已选中的会话看起来像未分组，首页重新显示“选择工作区”，重复点击还会创建更多空会话。

## 决策

`WorkspaceRuntime.connectWorkspace()` 会把所选工作区路径传给会话投影，同时仍只向 `session.create` 发送 `workspaceId`。创建成功后，`WorkspaceManager.attachSession()` 会在下一条 Host 帧到达前把 Host 已确认的会话 ID 写入该工作区本地的 `sessionIds`。

会话投影只在响应已确认的本地会话摘要中使用该路径。`session.create` 的 wire payload 不会扩展，仍只发送一个工作区 ID。

## 验证

`workspaces-service.client.spec.ts` 证明新建的工作区会话会立刻拥有规范目录、出现在所属工作区中，并能被第二次连接复用。`sessions-service.client.spec.ts` 证明本地目录投影不会把 `cwd` 加入工作区范围的 RPC payload。

## 备选方案

**等待 Host changed frame。** 帧是异步投递的，桌面传输可能让它排在用户动作之后，导致选择器视觉上没有选中项，并允许重复点击创建更多会话。

**从任意匹配的目录推断归属。** 在工作区外创建的会话可能使用同一个目录。复用仍只允许工作区本地成员列表中明确出现的 ID。

## 后果

- 会话创建成功后，所选工作区无需等待第二次列表刷新即可显示。
- 下一次权威工作区基线或 changed frame 会替换本地归属。
- 如果创建完成时工作区已被移除，客户端不会重新创建该工作区；成功的会话仍由 Host 基线分类。
