# `@deepseek-ai/dsh-user-context`

[English](README.md) | 中文

模型不可见的小薇用户上下文存储。每个 `(kind, key, workspaceId?)` 元组跨 Session 保存一个字符串值，由每个部署私有的 SQLite 文件支持，并公开为 `ctx.userContext`。

## 服务接口

kind 包括 `preference`、`working` 与 `profile`。`get`、`set`、`delete` 和 `list` 校验有界 key、值与可选 workspace id。全局条目不带 workspace id；workspace 条目不会覆盖对应全局值。SQLite 应用版本与 schema 版本会拒绝无关或不支持的文件。

## 模型体验

无。值只供可信 UI 与 Host consumer 使用，绝不进入模型上下文。

#### KV Cache 影响

无。保存的值不会组装进提示词或工具结果。

## 已知限制与后续工作

- **没有模型记忆 consumer。** 自动提取、提示词注入与模型控制写入均有意缺失。
- **每个部署只有一个本地数据库。** 尚未实现复制与跨 Host 冲突处理。
