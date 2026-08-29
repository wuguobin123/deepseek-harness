# `@deepseek-ai/dsh-account-api-provider`

[English](README.md) | 中文

小薇 Host API 的纯云端账号路由归属包。该包负责账号、钱包、模型密钥、自定义模型和账号插件的方法分类，提供通过认证账号转发的 Web Search，并实现账号所有者策略与错误码映射。它不依赖 Host API 网关或设备运行时，因此设备包可以完全不包含它。

`assertRoutePartition` 是装配门禁：完整的线路方法注册表必须是设备安全核心路由与 `ACCOUNT_RPC_METHODS` 的不相交并集。

## 模型体验

该包本身不直接对模型可见。其 Web Search 路由让已认证的小薇会话通过常规 `web_search` 工具路径返回规范化网页来源。

#### KV 缓存影响

装配阶段无影响；单次搜索结果追加在可复用的模型请求前缀之后。

## 已知限制与延后工作

- 账号 Web Search 需要有效的认证主体和可用的云端搜索提供方。
