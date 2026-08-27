# 账号远程 LLM 适配器

[English](README.md) | 中文

设备侧 `xiaowei-minimax` 路由通过 Node IPC 将 `MiniMax-M3` 推理委托给受信任的父进程。消息只包含可序列化的 JSON，不携带登录令牌、API Key、本机 Session 标识、Workspace 或文件系统路径。设备侧 Agent Loop 仍负责执行工具调用，并在后续模型请求中发送工具结果。
