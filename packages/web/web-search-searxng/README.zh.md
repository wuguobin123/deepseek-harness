# @deepseek-ai/dsh-web-search-searxng

[English](README.md) | 中文

面向自托管 [SearXNG](https://docs.searxng.org/) 实例的匿名 `WebSearchProvider`。它发送 `POST /search` 表单数据（`q` 与 `format=json`），并把 SearXNG 的 `results[]` 映射为规范化网页来源。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `$SEARXNG_BASE_URL`、`http://localhost:8080` | SearXNG 基址。允许 HTTPS；HTTP 仅允许 loopback 主机。 |
| `maxResponseBytes` | `1048576` | 最大响应体大小，必须为正整数。 |

```yaml
- id: web-search-searxng
  name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    baseURL: http://127.0.0.1:8080
```

无效 JSON、响应结构错误、非 2xx 响应、超大响应、网络失败和重定向会以 `WebError` 的 `WEB_PROVIDER_ERROR` 呈现；取消请求为 `WEB_ABORTED`。非 HTTP(S) URL 的结果会被省略。`available()` 只检查静态配置，不发起网络请求。

## 模型体验

通过 `dsh-tool-web` 间接影响模型；该工具会把规范化 SearXNG 来源或提供方错误渲染到对话模型的工具结果中。

#### KV 缓存影响

仅追加；新返回的来源位于可复用请求前缀之后，不会使已有 KV 缓存条目失效。

## 已知限制与延后工作

- 匿名访问消除了 API key 要求，但不保证上游搜索引擎始终可用；单个引擎仍可能限流、屏蔽请求或不返回结果。
- 提供方只返回 SearXNG 结果元数据；答案综合仍由对话模型负责。
