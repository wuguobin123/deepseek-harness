# Agent Note: 基于 Firecrawl 的 Web 研究检索

Status: implemented

[English](2026-08-25-firecrawl-web-research-provider.md) | 中文

## 问题

现有回环 SearXNG provider 会返回搜索结果，但不能在一次请求中提供基于来源研究所需的正文提取证据。引入另一套 Agent 框架会重复现有 `web_search` consumer 与 Agent 循环；开放不受限的显式 fetch 则会在按 profile 安全组合完成前过早暴露能力。

## 决策

小微采用 Firecrawl 作为首选 Web 搜索 provider。搜索请求同时启用 Firecrawl 正文 Markdown 提取，使现有 `web_search` consumer 和 Agent 循环无需引入另一套 Agent 框架即可完成基于来源的综合总结。缺少 `FIRECRAWL_API_KEY` 时，搜索降级到现有的本机回环 SearXNG provider。

`@deepseek-ai/dsh-web-provider-firecrawl` 包也通过 Firecrawl scrape 实现 `WebFetchProvider`。通用 standard preset 仍关闭显式 fetch。小薇的 profile 级 preset 启用该工具，以受保护的匿名 HTTP 作为主 provider，并把 Firecrawl 作为独立回退；只有主路径安全返回 HTTP 403 或 429 时才会调用回退。

## 安全和限制

Provider 调用 v2 REST API，不跟随重定向，校验外部 JSON，并限制响应字节数和保留文本长度；自定义 HTTP 端点只允许回环地址。抓取目标拒绝 URL 内嵌凭据和私网 IP 字面量。模型侧 Web 提示把所有返回正文标记为不可信证据，并要求引用对应 URL。

集成仅把 Firecrawl 作为外部服务调用，不复制其服务端实现。自行部署时必须遵守 Firecrawl 服务端许可证并限制该服务的网络出口。

## 验证

聚焦测试覆盖搜索正文映射、请求字段、抓取截断、URL 限制、凭据缺失、取消、HTTP 失败、异常 JSON、响应大小限制和模型侧不可信内容提示。

## 已考虑的替代方案

**只保留 SearXNG provider。** 它继续作为无密钥回环降级方案，但主搜索响应不包含 Firecrawl 提供的正文提取内容。

**采用 Firecrawl 的 Agent 编排。** Harness 已拥有模型循环、工具 schema、Session 日志与引用提示，因此这里只集成搜索与抓取提供方行为。

**在所有 standard preset 中启用显式 fetch。** Fetch 是否可见仍是产品决策。通用 preset 保持仅搜索；小薇会选择启用，因为它的 bundle 同时挂载了受保护 provider 和受限回退。

## 后果

已配置的部署可通过现有 `web_search` 工具获得提取后的 Markdown 证据；缺少凭据时仍降级到 SearXNG。配置 Firecrawl 作为搜索主路径时仍依赖其可用性、许可证与网络出口策略，但小薇抓取普通公开页面不再依赖 Firecrawl。

Provider 必须继续校验外部响应、限制保留内容，并拒绝不安全的抓取目标。小薇的显式 fetch 始终与受保护 HTTP 组合，主路径的安全或传输错误绝不调用 Firecrawl。
