---
sdd:
  id: capability.web.public-fetch
  kind: capability
  status: implemented
  owners:
    - web-platform
    - xiaowei-platform
  requirements:
    - id: REQ-web-public-fetch-001
      text: Web search and fetch execute through host-selected providers whose availability and credentials do not depend on the conversation model.
    - id: REQ-web-public-fetch-002
      text: The anonymous HTTP fetch provider connects only to a DNS-resolved public address that it validated and pinned, and it repeats validation for every redirect while preserving URL, time, size, content-type, and cancellation limits.
    - id: REQ-web-public-fetch-003
      text: An explicit fetch fallback may run only after the primary safely returns HTTP 403 or 429; blocked destinations, redirects, transport failures, timeouts, cancellation, and representation failures never trigger fallback.
    - id: REQ-web-public-fetch-004
      text: Xiaowei fetches public HTML and text through guarded HTTP without requiring a Firecrawl credential, and public GitHub repository or file URLs use GitHub's anonymous official content endpoints while retaining the submitted source URL.
  acceptance:
    - id: ACC-web-public-fetch-001
      text: Focused provider checks reject private, reserved, link-local, multicast, unspecified, and mixed public/private DNS answers for IPv4, IPv6, and IPv4-mapped IPv6, pin the validated address for connection, and repeat validation at redirects.
      evidence:
        - packages/web/web-fetch-http/tests/fetch-http.spec.ts
    - id: ACC-web-public-fetch-002
      text: Runtime checks prove that only HTTP 403 and 429 results enter the configured fetch fallback, a missing fallback credential preserves the primary result, and every other result or failure stays on the primary path.
      evidence:
        - packages/web/web/tests/web.spec.ts
    - id: ACC-web-public-fetch-003
      text: An assembled Xiaowei composition exposes web_fetch with guarded HTTP as primary and Firecrawl as fallback, deterministic provider checks retrieve GitHub repository and raw-file content through official endpoints without credentials, and the assembled runtime rejects a private destination before network access.
      evidence:
        - packages/web/web-fetch-http/tests/fetch-http.spec.ts
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-web-public-fetch-004
      text: The model-visible fetch transcript retains bounded Markdown content, source URL, status, truncation state, and untrusted-content guidance through the shipped tool path.
      evidence:
        - packages/web/tool-web/tests/tool-web.spec.ts
        - examples/acp-agent/tests/snapshots/web-fetch/system-prompt.expected.md
  evidence:
    - packages/web/web/src/index.ts
    - packages/web/web-fetch-http/src/provider.ts
    - packages/web/web-fetch-http/src/policy.ts
    - packages/bundle/xiaowei/cordis.patch.yml
    - packages/bundle/xiaowei/agent-presets/xiaowei-safe/agent.cordis.yml
  decisions:
    - .agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md
    - .agents/notes/implemented/feature/2026-08-25-firecrawl-web-research-provider.md
---
# 公网 Web 抓取

[English](public-fetch.md) | 中文

该能力为模型侧 Web 研究提供由宿主拥有的检索路径，使 Session 切换对话模型后仍保持稳定。搜索通过已配置 provider 发现 URL，抓取则通过另一条独立配置的 provider 链读取指定公网 URL。

## 能力

`ctx.web` 负责搜索与抓取 provider 选择。`@deepseek-ai/dsh-web-fetch-http` 负责匿名公网 HTTP 传输和目标地址约束。`@deepseek-ai/dsh-tool-web` 保持稳定的模型侧 schema，并把抓取到的 HTML 转为有界 Markdown。小薇选择受保护的 HTTP 作为抓取主 provider，并把 Firecrawl 作为可选回退。

## 需求

### REQ-web-public-fetch-001

Provider 选择、凭据、网络请求与响应解码归宿主运行时所有。对话模型决定是否以及如何调用稳定工具，但不提供或选择网络后端。

### REQ-web-public-fetch-002

直连 provider 只接受不含凭据的 HTTP(S) URL。它解析主机名，只要完整解析结果中存在非公网地址就拒绝请求，把已验证地址固定到每次连接尝试，在同一个截止期限下的有界传输重试间轮换地址，并在每次重定向请求前重复目标校验。响应字节数、解码字符数、重定向、超时、内容类型与取消限制继续生效。

### REQ-web-public-fetch-003

回退是范围严格的可用性补充，不是隐藏错误的优先级链。只有安全取得的 HTTP 403 或 429 响应才能进入显式回退。缺少回退凭据时返回主 provider 响应；其他回退失败保持可见。主路径的安全、传输、超时、取消、重定向与内容表示失败绝不触发回退。

### REQ-web-public-fetch-004

小薇无需 Firecrawl Key 即可读取公开 GitHub 仓库 README 和文件内容。直连 provider 将仓库根页面映射到 GitHub 匿名 README API，将 GitHub 或 `raw.githubusercontent.com` 文件 URL 映射到匿名 Contents API 并使用 GitHub raw 响应媒体类型，在结果中保留调用方提交的 URL，并对官方内容端点执行相同的公网地址与资源限制。私有仓库、Issue、Pull Request 和认证 GitHub 操作不属于匿名抓取能力，需要独立的账号隔离 GitHub 集成。

## 验收

### ACC-web-public-fetch-001

Provider 策略与传输测试覆盖 IP 字面量、DNS 解析结果、防重绑定连接固定和重定向重新校验，并证明被拒绝的目标不会收到网络请求。

### ACC-web-public-fetch-002

Web runtime 通过已注册 provider 测试完整的主响应与回退错误矩阵。

### ACC-web-public-fetch-003

Loader 组合验证小薇的 provider 选择、工具可见性和私网目标拒绝。Provider 集成测试验证仓库／文件 URL 映射、官方端点请求标头、来源 URL 保留与 raw 文本响应，另以独立的实时验收探针访问真实公网主机。

### ACC-web-public-fetch-004

现有无密钥工具快照与聚焦工具测试证明模型侧 Markdown 与安全提示。

## 决策

[Web capability seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)负责 provider 分离、选择与目标地址安全的设计理由。
