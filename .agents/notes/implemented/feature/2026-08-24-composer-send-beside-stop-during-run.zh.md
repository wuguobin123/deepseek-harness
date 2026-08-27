# Agent Note: Composer Send stays beside Stop while a run has a live draft

Status: implemented

[English](2026-08-24-composer-send-beside-stop-during-run.md) | 中文

## Problem

普通会话运行期间，composer 会把主 Send 按钮换成 Stop，因此“运行中提交已输入的后续消息”只有键盘手势可用——即 busy-Enter 偏好下的普通 Enter（[queue/steer composer 约定](2026-07-30-web-queue-steer-action.zh.md)）。持有草稿的指针用户只能看到一个可用操作，而这个操作是取消当前轮次：尽管投递路径（`session.prompt(mode: 'queue')` 进入 inbox）完整支持，但“排队补充内容”看起来就是不可用。运行中的 continuable child 早已解决了同样的展示问题：保持 Send 为主按钮，并把 Stop 暴露为独立按钮（[continuable interrupt](2026-08-06-continuable-subagent-interrupt.zh.md)）。

## Decision

InputBar 依据草稿而不是仅凭运行位推导主按钮。普通会话只在草稿为空时保留 Send/Stop 切换；运行中有草稿时主按钮保持 Send，Stop 移到独立按钮——即 continuable child 的布局。点击走的是与该布局的 Send 相同的状态机路径，恒为 Queue：“发送按钮与非键盘提交操作仍使用 Queue”这一成文规则不变，busy-Enter 偏好也保持其仅作用于键盘的范围。空草稿的运行状态保持单个 Stop 切换、不出现第二个按钮；one-shot child 仍不暴露 Stop；continuable child 不受影响。

### Verification

InputBar 组件规约固定了全部四种状态：空草稿运行时保持单个主 Stop；运行中有草稿时 Send 与独立 Stop 并存，指针排队与指针停止各自到达对应 sink；运行中 Enter 排队行为不变；one-shot child 永不渲染 Stop。所有组装 Web 快照捕获的运行中 composer 都是空草稿状态，因此已录制的浏览器输出均不变化。

## Alternatives considered

**只要会话在运行就并列显示 Send 与 Stop。** 否决：空草稿会让 Send 永久禁用地摆在 Stop 旁边，为承载一个操作而把最常见的运行态 chrome 翻倍；依据草稿推导能让每种状态只有一个主操作。

**让按钮跟随 busy-Enter 偏好执行 Steer。** 否决：composer 约定刻意让指针提交保持 Queue（[queue/steer note](2026-07-30-web-queue-steer-action.zh.md)）；steering 已有普通／加速 Enter 手势对与 dock 的逐条操作。

**保持仅键盘提交并文档化 Enter 手势。** 否决：这会让该能力在每个挂载共享 composer 的界面（Web 与 desktop 都是）上对指针用户始终不可发现，而唯一可见的按钮恰恰在最需要补充消息时变成取消轮次的操作。

## Consequences

共享 composer 一次改动即让 Web 与 desktop 同时获得指针排队路径，无需任何协议或 Host 工作：排队消息走现有的 `session.prompt(mode: 'queue')` 约定，并像其他排队行一样经 QueueDock 呈现。运行中 composer 的按钮集合取决于草稿是否存在，因此凡是断言运行态 chrome 的测试与快照都必须显式写明草稿状态；当前所有组装快照均为空草稿状态，不受影响。continuable-interrupt note 中关于普通会话切换的句子与 ui-conversation README 的提交段落已同步为已发布行为。
