---
sdd:
  id: feature.xiaowei.local-directory-import
  kind: feature
  status: implemented
---
# 小薇本机目录导入

[English](local-directory-import.md) | 中文

## 状态

首版使用一个包含 base64 文件内容的有界 JSON 请求，不提供可恢复分块上传。

## 运行规则

Electron 主进程打开原生目录选择器并遍历所选目录。它拒绝符号链接、junction、特殊文件、父目录遍历以及超出文件数、单文件字节数和总字节数限制的目录。请求只包含 `importId`、显示标题、相对文件路径和 base64 内容，本机绝对路径只留在主进程。

认证网关只从 bearer 主体派生所有权，在账号私有 workspace 根目录下 staging，并独立校验相对路径、规范 base64、重复路径、文件数和字节数限制，完整复制后原子发布并注册 Workspace。账号重复提交同一 `importId` 时返回原 Workspace。失败导入不会发布 Workspace。

返回的 Workspace 标题带有 `（导入副本）` 标记。副本独立存在，本机原目录后续修改不会同步。小薇账号 preset 只获得 `read`、`write`、`edit`、`glob` 和 `grep`，两套工具都会规范化模型指定的路径并拒绝离开当前会话 workspace；账号不会获得 shell、job、workflow 或委派执行能力。

## 限制

单次请求最多包含 200 个文件，单文件不超过 5 MiB，总计不超过 25 MiB，因此不适合大型目录；空的子目录不会被表示。未来分块协议必须继续保证 staging、幂等和原子发布。
