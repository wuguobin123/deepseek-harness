# Agent Note: 小薇本机运行时缓存与交互关联

Status: implemented

[English](2026-08-27-xiaowei-local-runtime-interaction-reliability.md) | 中文

## Problem

`workspace-write` confinement 会授权选定 Workspace 与平台临时区域，但命令行工具仍可能根据 `HOME` 推导缓存路径。在 macOS 上，Next.js 因此尝试创建 `~/Library/Caches/next-swc`，即使项目本身可写也会收到 `EPERM`。此外，桌面端会给交互问题请求的外层 RPC id 加上 Host 位置标签，却没有标记 `question/resolved.questionRpcId`。客户端可以把答案提交到正确的本机 Host，但无法让解决事件与等待中的问题卡片匹配。

## Decision

`LocalSandboxProvider.confine()` 只为 `workspace-write` 返回缓存环境覆盖项。这些覆盖项把 `XDG_CACHE_HOME` 和 `NPM_CONFIG_CACHE` 指向选定 runner 已经授权的临时区域。Bubblewrap 使用隔离的 `/tmp`；Landlock 与 Seatbelt 使用已授权的平台临时目录。Windows ACL runner 选定每个 Session 的私有临时目录后，会与 `TMP`、`TEMP` 一起设置相同变量。Bash 与 PowerShell 沙箱执行器在前台和后台进程中把 runner 拥有的覆盖项合并到调用方环境之后。只读 confinement 不获得可写缓存环境，`danger-full-access` 执行也不会经过 confinement。

桌面端双 Host 路由器把精确的 `questionRpcId` 字段视为 Host 拥有的关联 id。因此，`question/requested.rpcId` 与 `question/resolved.questionRpcId` 在到达客户端前会获得相同的位置标签。响应会去除该标签，并返回创建问题的 Host。客户端仍然只在权威的 resolved 事件到达后移除卡片。

## Alternatives considered

**向 workspace-write 命令授权用户缓存目录。** 未采用，因为这会把限定于 Workspace 的写入能力扩展到无关的用户状态，并允许命令修改与 Session 外部进程共享的缓存。

**在 Electron 本机运行时 supervisor 中设置缓存变量。** 未采用，因为 supervisor 不知道 runner 选定的 Windows 私有临时目录，还会同时影响只读与 `danger-full-access` 命令，并会把环境选择与赋予目录可用性的写入能力拆开。

**响应调用返回后立即关闭问题卡片。** 未采用，因为传输响应成功不能证明 Host 已经接受并持久解决问题。resolved 事件仍是权威的生命周期信号。

## Consequences

`workspace-write` 命令可以填充常见框架与包管理器缓存，而无需取得用户主目录缓存的写权限。POSIX runner 保留既有的临时区域共享方式；Windows 继续保持更强的逐 Session 临时隔离。忽略 `XDG_CACHE_HOME`、`NPM_CONFIG_CACHE`、`TMP` 和 `TEMP` 的工具可能仍需另行论证环境映射，但这不会扩大 confinement。

本机交互问题现在与云端问题采用相同的等待卡片生命周期。未来任何 Host 拥有的关联字段仍需明确加入路由分类和回归测试，不能把任意 `*Id` 字段都假定为带执行位置的资源。
