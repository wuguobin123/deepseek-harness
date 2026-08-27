# Agent Note: Ops Skill frontmatter closing boundary

Status: implemented

[English](2026-08-26-ops-skill-frontmatter-closing-boundary.md) | 中文

## Problem

ops Skill loader 找到 frontmatter 结束分隔符后返回了错误的行首字段，导致 YAML 元数据被解析为空，内置 Skill 无法按声明验证。

## Decision

loader 在切分 frontmatter 块前记录结束分隔符的实际行首。组装后的 loader 测试覆盖内置 `next-best-action` Skill 的发现、元数据加载和释放；无密钥验证器覆盖 manifest 和正文。

## Verification

聚焦的 `packages/ops/ops-skill/tests/loader-composition.spec.ts` 测试通过，`python3 docs/ops/templates/verify.py` 在无模型调用和网络访问的情况下验证内置 Skill。

## Alternatives considered

**放宽元数据验证。** 忽略空元数据会掩盖解析缺陷并允许错误 Skill 加载，因此修复了 loader 的边界。

**只修改 fixture。** 修改预期元数据会保留错误的运行时行为，因此不采用。

## Consequences

内置 Skill 元数据可供组装后的 loader 使用，并在 manifest smoke 和 loader 测试两个层级持续覆盖。修复仅限 frontmatter 解析；Skill 运行时行为仍为只读。
