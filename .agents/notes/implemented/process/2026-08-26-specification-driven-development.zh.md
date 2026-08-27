# Agent Note: Specification-driven development workflow

Status: implemented

[English](2026-08-26-specification-driven-development.md) | 中文

## Problem

Ops 场景需要一个持久位置来说明需求、验收、负责人和证据，同时不复制运行时集成契约或决策理由。

## Decision

仓库使用 SDD 参考文档和三个模板，分别处理平台功能、可复用能力和外部集成。规格在实现前归一化，使用全局唯一的需求和验收 ID，并从 `draft` 经过 `approved` 进入 `implemented` 或 `retired`。implemented 规格为每个验收 ID 列出仓库相对证据。

`next-best-action` Skill 是第一个 implemented 能力规格。它的证据列出无密钥 ops 模板验证器和组装后的 Skill loader 测试。集成规格记录身份、凭据以及每个操作的模式、风险、审批、幂等性、重试、补偿和审计字段。

SDD 负责必须满足的内容。`docs/ops/scenario-integration-contract.md` 负责 Skill/Subagent 运行时边界，Agent Note 负责理由、落选替代方案和后果。SDD Skill 链接这些记录，而不是复制其内容。

## Alternatives considered

**仅使用 Agent Note。** Agent Note 解释持久决策为何作出，但不提供稳定的逐需求验收映射，因此不能充当实现清单。

**仅使用 ops 场景契约。** 场景契约定义运行时集成规则，而不是任意平台或能力的需求与证据；扩展它会让一个文档承担无关范围。

**使用一个通用模板。** 功能、能力和集成工作的负责人及控制字段不同；独立模板可以明确集成控制，而不让简单规格承担额外字段。

## Consequences

新的非机械工作在实现前拥有可审阅规格，在完成前拥有路径级证据映射。仓库会增加少量双语镜像结构，并且编辑后必须重新记录翻译 sidecar。证据路径只证明所声明的仓库层级；部署或生产声明仍需各自的运维观测。
