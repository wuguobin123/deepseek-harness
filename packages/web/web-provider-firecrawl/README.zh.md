# `@deepseek-ai/dsh-web-provider-firecrawl`

[English](README.md) | 中文

将同一个 Firecrawl 实例同时注册为 `WebSearchProvider` 和 `WebFetchProvider`。搜索请求要求 Firecrawl 为每个结果提取正文 Markdown，因此 `web_search` 无需再次访问站点也能基于网页正文作答；对已知 URL 的抓取使用 Firecrawl scrape 接口。

## 配置

```yaml
- id: web-provider-firecrawl
  name: '@deepseek-ai/dsh-web-provider-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

`FIRECRAWL_API_URL` 可覆盖托管端点 `https://api.firecrawl.dev/v2`。自定义端点必须使用 HTTPS；仅独立部署在本机的服务可使用回环 HTTP。`maxResponseBytes`、`maxSearchContentChars` 和 `maxFetchBodyChars` 限制不可信远端数据的大小。

Provider 每次调用都会重新解析凭据。缺少密钥时抛出 `WEB_PROVIDER_CREDENTIAL_MISSING`，使 `ctx.web` 能切换到已配置的凭据缺失搜索降级 provider。

## 安全

API 请求不跟随重定向。抓取目标必须是不含 URL 凭据的 HTTP(S) 地址，并拒绝回环和私网 IP 字面量。搜索返回的正文仍属于不可信网页数据；模型侧 `dsh-tool-web` 提示要求仅把正文用作证据并引用对应 URL。

本包只调用 Firecrawl 公开 REST API，不嵌入 Firecrawl 服务端代码。自行部署 Firecrawl 时，运维方负责该独立服务的许可证合规和网络出口策略。

## 模型体验

间接影响。`dsh-tool-web` 负责模型可见 schema、不可信内容指引与结果渲染。

#### KV Cache 影响

本 provider 不产生影响。consumer 的固定 Web 指引决定可复用请求前缀。

## 已知限制与后续工作

- **依赖外部服务。** 搜索与抓取的可用性、配额、许可证和出口策略取决于配置的 Firecrawl 部署。
- **不跟随重定向。** 搜索或抓取端点发生重定向时直接失败。
