# Agent Note: 小薇本机目录导入

Status: implemented

[English](2026-08-26-xiaowei-local-directory-import.md) | 中文

## Problem

远程小薇桌面端此前把“添加工作区”路由到服务器目录浏览。该 surface 无法选择运行 Electron 的电脑上的文件；如果直接向账号会话开放普通文件系统 consumer，模型控制的绝对路径又会读取账号 workspace 外的文件。

## Decision

远程 base URL 下，Electron 选择并序列化一个有界、无链接的本机目录，调用 `workspace.importDirectory` 时不披露本机绝对路径。该方法只从 bearer 主体派生所有权，在账号根目录下 staging，原子发布并创建带 `（导入副本）` 标记的 Workspace。小薇账号 preset 挂载文件与搜索 consumer 时，强制按规范路径限定在当前会话 workspace。当前导入使用单次 JSON 请求，最多 200 个文件、单文件 5 MiB、总计 25 MiB。

## Alternatives considered

**保留远程浏览。** 已否决：它只能看到服务宿主，无法选择 Electron 所在电脑的目录。

**原样挂载标准文件系统 consumer。** 已否决：绝对路径和指向外部的符号链接搜索根会暴露账号 workspace 外的文件。

**首版直接实现可恢复分块上传。** 延期到产品明确支持超过首版上限的大目录时再做。

## Consequences

用户可以选择普通本机目录，并立即探索或编辑其服务器私有副本。导入后源目录的变化不会同步，空子目录会被省略，大目录需要未来的传输协议。账号会话获得文本文件探索能力，但没有 shell 权限，也看不到宿主其他文件。聚焦的桌面端、API、文件系统和搜索测试覆盖选择、传输、回滚、所有权和限定路径。

## Related

- [桌面端自适应目录流](../bug-fix/2026-08-23-desktop-adaptive-directory-flow.zh.md)，其中远程 Electron 连接部分已被本决策部分取代。
