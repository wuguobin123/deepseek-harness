---
sdd:
  id: feature.xiaowei.account-web-search-routing
  kind: feature
  status: approved
  owners:
    - xiaowei-platform
    - web-platform
  requirements:
    - id: REQ-xiaowei-account-web-search-routing-001
      text: A signed-in local Workspace uses the authenticated production Host's configured Web search capability without requiring or receiving a provider credential on the device.
    - id: REQ-xiaowei-account-web-search-routing-002
      text: The account Web search request carries only a bounded query and result limit; the production Host derives account ownership from the bearer principal and rejects caller-supplied account, Workspace, Session, path, file-reference, provider, and credential fields.
    - id: REQ-xiaowei-account-web-search-routing-003
      text: Electron retains the bearer and relays search between the device Worker and the account RPC, while the local Agent loop, Session log, files, Shell, Skills, approvals, artifacts, and tool-result continuation remain in the device Host.
    - id: REQ-xiaowei-account-web-search-routing-004
      text: Cancellation, sign-out, account switching, authentication expiry, malformed frames, crossed request identifiers, provider failure, and cloud unavailability terminate only the affected search and never fall back to a local provider credential or move the local Session to the cloud.
    - id: REQ-xiaowei-account-web-search-routing-005
      text: Cloud Workspace search keeps the production Host's existing provider selection, credentials, safety policy, result format, and model-facing tool schema.
  acceptance:
    - id: ACC-xiaowei-account-web-search-routing-001
      text: Account RPC schema and service checks prove principal-derived ownership, authenticated access, bounded requests and results, provider-error preservation, cancellation, and rejection of every forbidden identity, local-resource, provider, and credential field.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-002
      text: Device Provider and Electron checks prove concurrent request correlation, cancellation, malformed and crossed-frame rejection, bearer confinement to Electron, and exact propagation of structured search results and failures.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-003
      text: An assembled keyless device runtime with no DEEPSEEK_API_KEY executes web_search through a scripted authenticated parent, records the returned sources in the local Session, and retains the local filesystem, Shell, and Skill capability roster.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-004
      text: Production and packaged-client acceptance proves that cloud Workspace Web search still succeeds, a signed-in local Workspace returns a cited URL through web_search, and a subsequent local file write changes the original device directory without creating a cloud Workspace or Session.
      evidence: []
  evidence: []
  decisions:
    - .agents/notes/proposed/architecture/2026-08-27-xiaowei-account-web-search-routing.md
    - .agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.md
    - .agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md
---
# 本机工作区账号路由 Web 搜索

[English](account-web-search-routing.md) | 中文

## Outcome

已登录的小薇本机工作区通过账号生产 Host 执行搜索，而 Agent 与执行效果仍留在设备。用户无需配置独立的设备搜索密钥，设备也不会取得生产 Provider 凭据。

## Requirements

### REQ-xiaowei-account-web-search-routing-001 through REQ-xiaowei-account-web-search-routing-005

文档头部定义可观察需求。搜索使用一个明确的账号 RPC，而不是通用远程工具通道：设备发送有界搜索输入，Electron 使用既有认证传输，生产 Host 应用其配置的 `ctx.web` Provider 策略。

## Acceptance

### ACC-xiaowei-account-web-search-routing-001 through ACC-xiaowei-account-web-search-routing-004

协议、设备 Provider、Electron、组装运行时、生产服务与已安装客户端检查分别证明不同层级。源码或单元检查不能替代已打包本机工作区结果。

## Decisions

[账号 Web 搜索路由决策](../../../.agents/notes/proposed/architecture/2026-08-27-xiaowei-account-web-search-routing.zh.md)记录能力专属传输与安全选择。[联邦桌面端提案](../../../.agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.zh.md)记录 Host 联邦与设备执行。[Web 能力决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)记录稳定工具与 Host 选择 Provider。
