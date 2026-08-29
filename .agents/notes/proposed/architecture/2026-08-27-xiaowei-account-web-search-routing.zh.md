# Agent Note: 小薇账号路由 Web 搜索

Status: proposed

[English](2026-08-27-xiaowei-account-web-search-routing.md) | 中文

## Problem

设备 Host 组合了标准 Web 搜索工具，却从本机凭据存储选择需要密钥的 DeepSeek Provider。已登录账号可以通过 Electron 使用平台模型而无需取得上游模型凭据，但同一个本机 Session 仍必须由用户在设备上另行配置 `DEEPSEEK_API_KEY` 才能搜索。一个产品账号因此被拆成互不关联的凭据路径，并把用户未选择的 Provider 配置暴露给普通用户。

## Proposal

设备 Host 将选择账号远程 Web 搜索 Provider。它通过专用子进程协议向 Electron 发送一个有界查询与结果上限。Electron 调用一个已认证的 `account.web.search` 端点，生产 Host 在 Bearer principal 下调用其配置的 `ctx.web.search` 实现。搜索结果与结构化失败返回本机工具管线，并保留在本机 Session 日志中。

子进程协议与账号端点只服务这一项能力。它们不接收任意工具名、账号标识、资源标识、路径、文件引用、Provider 选择、Bearer 或凭据。Bearer 由 Electron 保留，Provider 凭据由生产 Host 保留，生产 Host 只从已认证 principal 派生身份。

取消与身份变化会终止所有传输层上的未完成搜索。设备 Provider 使用不透明请求 ID 关联并发请求，并拒绝畸形或串线帧。认证、传输或生产 Provider 失败时，它不会回退到设备凭据。

云端工作区搜索继续直接调用同一个生产 `ctx.web` 服务。本机与云端工作区的文件系统、Shell、Skill、审批、产物与 Agent Loop 归属均保持不变。

## Alternatives considered

**把生产搜索凭据复制到设备。** 不采用，因为这会让部署凭据离开服务端轮换、撤销与静态密钥控制，还需要同步设备凭据。

**把账号推理复用为通用工具中继。** 不采用，因为模型流与 Web 能力执行具有不同的请求、取消、失败与授权规则。通用中继会为未来工具静默建立远程执行通道。

**把本机提示发送到执行研究的云端 Session。** 不采用，因为这会把 Agent Loop 与持久对话迁到生产 Host、丢失本机工具结果续接，并混淆云端 Session 创建与账号能力使用。

**保留本机 DeepSeek Provider 作为回退。** 不作为已登录默认路径，因为行为会依赖无关的设备密钥，并可能绕过生产 Host 的 Provider 策略。自定义本机 Provider 仍属于独立显式配置。

## Acceptance criteria

本记录转为 implemented 之前，已批准的[功能规格](../../../../docs/specs/xiaowei/account-web-search-routing.zh.md)必须具备已认证 RPC、设备与 Electron 取消、无密钥组装本机运行时、生产云端回归及已安装客户端本机工作区搜索证据。

## Risks

搜索结果是未受信任的网络数据，必须保留 Web 能力既有边界与结果表示。Electron 新增一类长生命周期子进程请求，退出登录、切换账号、Worker 重启与应用关闭时必须等待其清理完成。生产 Provider 可用性成为已登录本机研究的依赖，但失败只影响该工具调用，绝不会改变工作区归属。
