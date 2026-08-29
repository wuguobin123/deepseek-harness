---
sdd:
  id: capability.xiaowei.federated-tool-capabilities
  kind: capability
  status: approved
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-federated-tool-capabilities-001
      text: Local and cloud Hosts publish the same capability manifest entries for a shared tool name, input schema, result schema, render intent, error taxonomy, and risk classification.
    - id: REQ-xiaowei-federated-tool-capabilities-002
      text: Each Host owns execution, runtime state, data access, and side effects for its location; a tool call cannot transfer ownership of those resources to the other Host.
    - id: REQ-xiaowei-federated-tool-capabilities-003
      text: Cross-Host communication is limited to explicitly typed relays whose request and result types name the destination location and whose fields are allowlisted for that capability.
    - id: REQ-xiaowei-federated-tool-capabilities-004
      text: The runtime does not provide a generic remote tool bus, dynamic tool forwarding, or an untyped proxy that can execute arbitrary capabilities on the other Host.
    - id: REQ-xiaowei-federated-tool-capabilities-005
      text: Location routing fails closed when a location is absent, unsupported, ambiguous, unauthorized, or missing a manifest-parity declaration; no call executes on a fallback Host.
    - id: REQ-xiaowei-federated-tool-capabilities-006
      text: A manifest and parity gate rejects a Host composition when the shared tool contract differs in name, schema, result, render intent, error taxonomy, or risk classification.
    - id: REQ-xiaowei-federated-tool-capabilities-007
      text: The assembled regression for web_search asserts the exact shared tool name and contract on both local and cloud Hosts, including its render and failure behavior.
    - id: REQ-xiaowei-federated-tool-capabilities-008
      text: Acceptance reports distinguish keyless source and assembled evidence from installed-client and release evidence, and does not claim installed or production behavior without those observations.
  acceptance:
    - id: ACC-xiaowei-federated-tool-capabilities-001
      text: A keyless source check proves that local and cloud manifest entries for a shared tool have byte-equivalent contract fields and location-specific Host ownership metadata.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-002
      text: An assembled Xiaowei composition runs one typed relay per declared cross-Host operation, rejects arbitrary capability forwarding, and leaves execution, state, data, and side effects on the destination Host.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-003
      text: Focused routing checks reject missing, unsupported, ambiguous, and unauthorized locations without invoking either Host as a fallback.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-004
      text: The manifest/parity gate rejects each independently changed shared contract field and accepts matching local/cloud declarations.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-005
      text: The assembled web_search regression checks the exact tool name, input and result schemas, render intent, error taxonomy, risk classification, and successful and failed calls on both Hosts.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-006
      text: The acceptance report labels source and assembled checks as keyless evidence and leaves installed-client and release evidence pending until real installed and published surfaces are observed.
      evidence: []
  evidence: []
  decisions:
    - .agents/notes/proposed/architecture/2026-08-29-xiaowei-federated-tool-capabilities.md
    - docs/architecture.md
---

# Xiaowei federated tool capabilities

[English](federated-tool-capabilities.md) | 中文

## 能力

该能力让 Xiaowei 本地和云端 Host（主机）共享一套可发现的工具词汇，同时保持每个位置的执行与数据归属独立。能力所有者是 `xiaowei-platform`；本地和云端 Host 分别拥有自己的运行时状态和副作用。

## 共享工具约定

每项共享能力都通过 manifest（元数据清单）项声明精确的 `name`、输入 JSON Schema、结果 JSON Schema、render intent（渲染意图）、error taxonomy（错误分类）和 risk classification（风险分类）。渲染意图是数据，不由客户端重新解释；错误和风险字段属于模型可见约定。Local 和 cloud 项必须在暴露之前对这些字段达成一致。

`web_search` 项是精确回归样例。两个 Host 的名称、schema、渲染意图、错误分类和风险分类会被比较，组装测试会执行成功与失败结果。列表项或静态注册本身不能证明执行成功。

## Host 归属与中继

被选中的 Host 拥有能力执行、可变运行时状态、源数据读写、凭据和副作用。本地调用留在本地，云端调用留在云端。中继只能传递已声明的 typed（类型化）请求和类型化结果，并带有明确目标位置；不得包含任意工具名、模块、路径、凭据或执行选项。

运行时不提供通用 remote tool bus（远程工具总线）。需要跨 Host 操作的能力必须声明窄范围中继类型，以及其授权、序列化、取消和错误行为。未声明的转发在执行前拒绝。

## 路由与 parity

路由要求一个明确位置、对该位置有权限的已认证主体，以及通过 parity（对等一致性）检查的 manifest 项。缺失、不支持、含糊或未授权的位置数据快速失败；路由器不会重试到或静默选择另一个 Host。

manifest/parity 门禁在组装前比较共享约定字段。Host 归属字段只有在 manifest 明确标记所有权、数据位置和执行状态时才可以不同；这些差异不能改变共享工具约定，也不能许可远程副作用。

## 验收与证据

无密钥 source（源代码）检查证明声明结构、类型化中继限制、路由拒绝、parity 失败和组装行为；它们不能证明打包 Electron 客户端、已安装的账号/工作区、已发布产物或生产可用性。安装态和发布证据必须来自真实安装客户端与已发布表面；在这些观察产生前，本规格不记录此类证据。

## 决策

提案的理由、否决的替代方案和后果记录在[proposed Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-xiaowei-federated-tool-capabilities.zh.md)。产品级组装仍由[架构参考](../../architecture.zh.md)规定。
