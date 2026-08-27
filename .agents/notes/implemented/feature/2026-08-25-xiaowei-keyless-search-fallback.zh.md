# Agent Note: Xiaowei 无密钥搜索回退

Status: implemented

[English](2026-08-25-xiaowei-keyless-search-fallback.md) | 中文

## 问题

Xiaowei 通过 `xiaowei-minimax/MiniMax-M3` 路由账户自有聊天，而 base web bundle 通过独立的 DeepSeek Messages API 路由 `web_search`。因此，没有部署级 `DEEPSEEK_API_KEY` 时 MiniMax 账户仍可聊天，但模型发起的每次搜索都会以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。切换聊天模型无法修复这个独立的搜索提供方。

搜索 seam 原先只选择一个提供方，并刻意不使用注册顺序表达优先级。如果对所有错误都无条件回退，限流、上游故障、无效响应、网络失败、超时和取消都会被伪装成成功切换提供方，运维人员将难以定位真实故障。

## 决策

`dsh-web` 在显式 `searchProvider` 旁接受显式且不同的 `searchCredentialFallbackProvider`。运行时每次调用都解析主提供方，仅当主提供方抛出 code 为 `WEB_PROVIDER_CREDENTIAL_MISSING` 的 `WebError` 时尝试回退。其他错误全部原样抛出。对应环境变量为 `DSH_WEB_SEARCH_CREDENTIAL_FALLBACK_PROVIDER`；它只向同一配置字段供值，不形成隐藏优先级链。

`dsh-web-search-searxng` 基于 SearXNG 文档化的 `POST /search` JSON API 实现匿名搜索提供方。它接受 HTTPS 端点和 loopback HTTP 端点，拒绝重定向与内嵌凭据，限制响应体大小，校验外部 JSON，省略非 HTTP(S) 结果 URL，并把取消映射为 `WEB_ABORTED`。它不抓取搜索引擎 HTML 页面，也不依赖非官方公共实例。

Xiaowei patch 选择 `firecrawl` 作为主 provider，只在缺失凭据时选择 `searxng`。Provider 执行归宿主运行时所有，因此 Session 切换对话模型不会改变搜索路径。部署默认把 `SEARXNG_BASE_URL` 设置为 `http://127.0.0.1:18081`；部署方可通过启动环境层替换该值。其他 bundle 保持原有选择。

## 部署与安全

`scripts/deploy_xiaowei.sh` 部署按多架构镜像 digest 固定的 SearXNG 官方容器。Docker 只在 `127.0.0.1` 发布端口，nginx 不对外暴露。生成的 SearXNG secret 保存在 `/etc/dsh-xiaowei/searxng`，settings 文件以只读方式挂载，容器日志执行轮转；实例关闭公共实例功能及面向公网的 bot limiter，因为只有本机 Xiaowei 进程可以访问。系统不保存搜索 API Key。生产 settings 只保留无需 key 的 Bing 中国站和搜狗引擎，因为该主机可访问两者且两者均能返回结果；镜像默认启用的 Brave、DuckDuckGo、Google CSE、Startpage 和 Wikipedia 引擎在当前网络中均会超时。

部署闸门会先启动或更新 SearXNG，再重启 Xiaowei，并提交一次必须返回至少一个来源的真实 JSON 搜索。容器启动失败、JSON 响应无效或为空、loopback 端点不可达都会在应用重启前终止部署。重启后仍必须通过 Xiaowei 原有的 loopback 与 nginx 健康检查。

SearXNG 聚合的上游引擎仍可能独立限流、拒绝请求或返回空结果。这些情况会继续表现为提供方错误或空结果，不会再落入另一个隐藏后端。

## 测试

运行时单元测试证明缺失凭据时成功回退、非凭据错误原样抛出以及无效回退配置被拒绝。SearXNG provider 测试覆盖映射、静态端点策略、表单请求、响应上限、格式错误和结构无效的 JSON、网络及 stream 失败、取消时序、插件卸载、环境默认值和 invariant companion，并达到逐文件 100% 覆盖率。

真实 Loader 测试在没有 Firecrawl 凭据的情况下启动随附的 base、headless 与 Xiaowei bundle 层，调用 `ctx.web.search` 并观察本地 SearXNG JSON provider。无密钥浏览器快照会重放模型发起的 `web_search` 轮次，证明没有产生辅助搜索模型请求，并校验模型与客户端可见的持久成功来源列表。

## 生产验收

2026-08-25 的范围化发布保留了 `/opt/dsh-xiaowei.bak-20260825T040147Z`，在 `127.0.0.1:18081` 部署固定版本的 SearXNG 容器，并重启 `dsh-xiaowei`，自动重启次数为零。loopback 与 nginx 健康检查均返回 `ok`，组合后的 profile 指定 `deepseek-official` 并以 `searxng` 回退；生产 seam 探针显式移除 `DEEPSEEK_API_KEY` 后，对 `济南 天气` 返回五个受限来源，其中包括中国天气网和国家气象中心。部署后运行时文件 hash 与本地范围化产物一致。

## 备选方案

**在 Node 进程中抓取 DuckDuckGo HTML。** DuckDuckGo 没有适用于此用途的官方通用搜索 API；HTML 抓取会把产品绑定到未文档化的页面结构和反爬机制。自托管 SearXNG 提供文档化 JSON 接口，并把引擎变化隔离在应用进程之外。

**使用免费公共 SearXNG 或代理端点。** 公共实例存在部署无法控制的可用性、隐私、限流和政策依赖。loopback-only 实例把请求处理保留在受管主机内，同时仍依赖所选上游引擎获取公开结果。

**对主提供方的所有失败都回退。** 这会把 DeepSeek 401、429、5xx、超时、取消、解析和网络故障变成另一个后端的响应。实现只在主提供方因指定凭据缺失、尚未发起请求时回退。

**全局替换 DeepSeek 搜索。** 已配置 DeepSeek 搜索凭据的部署继续保留其辅助模型行为。只有 Xiaowei 需要无密钥路径，因为其聊天凭据属于账户并来自另一个提供方。

## 影响

Xiaowei 无需配置 DeepSeek 模型或搜索 Key 即可搜索，同时运维人员仍能看到真实提供方故障。生产环境新增对固定版本 SearXNG 容器及其聚合公网引擎的依赖。升级时，运维人员必须监控 loopback 容器、主动更新 digest、保留生成的 settings 目录，并审查 SearXNG 上游变更和许可证义务。
