# Agent Note: 小薇设备 Remote carrier

Status: implemented

[English](2026-08-27-xiaowei-device-remote-carrier.md) | 中文

## Problem

小薇桌面端会把本机 Session 的生成 Remote 调用路由到回环设备 Host。设备 carrier 只暴露固定 ApiProxy 方法表，因此即使本机服务与生成 descriptor 已激活，`commands/list` 等有效 Typert endpoint 仍会返回 HTTP 404。

## Decision

设备 carrier 将固定 ApiProxy dispatcher 与当前 Typert Gateway 组合。它先询问 Gateway 是否声明 `<namespace>/<method>` endpoint，保留现有 client-request 与 server-response envelope，再通过 Web carrier 共用的 helper 分发已验证 `args` payload。未知 slash endpoint 仍返回 HTTP 404，监听地址仍限制为 `127.0.0.1`。

Typert Gateway 以独立于物理 carrier 的方式公布 endpoint 归属。Web Connection interceptor 与设备 carrier 共用该归属检查，因此生成定义、源码反射 fallback、撤销、lookup 失败与取消保持同一分发策略。

## Alternatives considered

**把生成 Remote 调用路由到生产 Host。** 不采用，因为本机 Session 与 Agent 标识只属于设备 Host；云端分发会导致 lookup 失败或破坏执行隔离。

**为每个生成 endpoint 添加固定设备路由。** 不采用，因为包新增、移除或撤销 Remote contribution 时，该列表会发生漂移。

**在设备进程中运行完整 Web carrier。** 不采用，因为设备运行时只需要回环 unary 与事件传输，不需要另一套渲染器、静态文件服务或浏览器插件组合。

## Consequences

本机命令、目标、文件引用、消息反馈、插件清单及其他生成 Remote 都通过同一桌面连接使用设备服务。设备 carrier 增加对 Typert Gateway 的运行时依赖，并且只在两个 unary dispatcher 都可用后启动。carrier 与 Gateway 测试固定已声明 endpoint 的分发以及未知 endpoint 的拒绝行为；已安装客户端验收仍负责证明打包依赖闭包与渲染器行为。
