# Agent Note: 桌面端下行链路故障对重连逻辑保持可见

Status: implemented

[English](2026-08-25-desktop-downlink-reconnect.md) | 中文

## Problem

Electron 主进程会把 WebSocket 载体故障转换为 IPC `stream/error` 帧，但渲染进程传输层会丢弃该帧。物理载体结束后，其异步迭代器因此一直处于等待状态，`ConnectionController` 无法观察到流已结束，也无法重连。即使不活跃的工作区可能合理地超过 90 秒没有任何事件，主进程此前仍会把这种情况视为连接失效。移除该截止时间后又暴露出相反问题：静默黑洞中的 TCP 连接仍显示为 `ESTABLISHED`，一元消息提交可以完成，但缓存的已打开 Session 永远收不到对应事件。

## Decision

桌面端 WebSocket 载体使用协议级 ping/pong 帧检测传输存活，不再根据应用事件判断。mux 和 host 连接每 30 秒发送一次 ping，并要求在 10 秒内收到 pong 或其他入站帧。错过截止时间会以 `HEARTBEAT_TIMEOUT` 终止载体。主进程把该故障作为符合 schema 的 `stream/error` 信封发出，其中包含非空关联 ID、协议定义的 `internal` 代码和传输故障消息。渲染进程会像 Web 传输层一样校验并产出该帧，使 `ConnectionController` 结束当前连接代次、重连两个载体，并执行正常的状态重新同步。

## Alternatives considered

- **在 Electron 主进程内重连** — 未采用，因为 `ConnectionController` 已经负责配对管理 mux/host 连接代次、重试退避、状态转换和连接后的重新同步。再增加一个重连循环会拆分生命周期所有权。
- **保留 90 秒空闲截止时间并只依赖重连** — 未采用，因为只要工作区处于安静状态，它就会主动反复切换健康连接，造成不必要的事件空档和服务器负载。
- **既不设置空闲截止时间也不发送心跳** — 未采用，因为 TCP `ESTABLISHED` 不能证明下行帧仍能通过链路；客户端不应依赖重载渲染页才能发现静默黑洞。
- **继续丢弃 `stream/error`，另加一个 IPC 关闭事件** — 未采用，因为现有帧联合类型和连接控制器已经定义了两种传输都需要的终止信号。

## Consequences

- 安静的桌面端会话会在 pong 帧证明传输存活时保持已有 WebSocket 载体。
- 网络故障、心跳超时和意外正常关闭都会进入现有的重连与实时事件空档修复路径。
- 桌面端传输测试固定静默黑洞检测、健康空闲连接、主进程终止信封，以及渲染进程向连接层交付该信封的行为。
