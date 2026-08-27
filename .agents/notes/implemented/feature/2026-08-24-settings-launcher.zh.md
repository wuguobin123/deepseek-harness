# Agent Note: 产品自有设置入口

Status: implemented

[English](2026-08-24-settings-launcher.md) | 中文

## Problem

桌面账户入口需要直接打开指定的设置分区，同时通用 Web 设置外壳仍需可复用。

## Decision

设置领域声明可选的 `settings.launcher` 单项 slot。外壳提供 `wide`、`isOpen`、`openSettings` 和 `openSection`，缺席时渲染原有触发按钮作为 fallback。桌面在该 slot 注册账户行，直接打开 `account`，更新检查保持为独立操作。

## Alternatives considered

**保留账户 popover。** 未采用，因为这会重复身份与设置呈现，而不是进入真正持有这些控件的「账户」分区。

**替换通用触发器且不保留 fallback。** 未采用，因为没有产品自有入口的 Web 组合会失去唯一的设置入口。

## Consequences

桌面账户身份现在属于设置入口行；rail 保留独立更新点击区，点击更新不会打开设置。

## Verification

ui-settings-general 窄 Vitest、桌面测试套件、客户端契约与桌面类型检查、桌面生产构建、客户端目录校验及 `git diff --check` 均已通过。桌面 DOM 测试固定入口与更新按钮的顺序和点击隔离；该产品自有入口尚无已打包 Electron 视觉快照覆盖。
