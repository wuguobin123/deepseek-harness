---
sdd:
  id: feature.xiaowei.local-skill-directory-management
  kind: feature
  status: implemented
  owners:
    - xiaowei-desktop
  requirements:
    - id: REQ-xiaowei-local-skill-directory-management-001
      text: 桌面端把用户选择的本地 Skill 目录及其嵌套普通文件安装到正式客户端用户数据目录下的运行时中，不上传目录，也不向渲染进程暴露源路径或目标路径。
    - id: REQ-xiaowei-local-skill-directory-management-002
      text: 安装必须校验根目录 SKILL.md，拒绝链接和特殊文件，执行文件数与字节数上限，并原子提交完整目录，且不得替换内容不同的已有 Skill。
    - id: REQ-xiaowei-local-skill-directory-management-003
      text: 桌面设置页展示可搜索的本地已安装 Skill 目录清单，包括无效条目，且该清单独立于特定 Session 中生效的 Skills。
    - id: REQ-xiaowei-local-skill-directory-management-004
      text: 有效 Skill 在桌面端重启后仍可用，并通过现有斜杠命令约定调用。
    - id: REQ-xiaowei-local-skill-directory-management-005
      text: 一个用户显式的 /<skill-name> 手势对获准进入的步骤最多贡献一条持久化 skill-invocation 消息，包括重叠运行时作用域同时挂载 Skill 消费器的情况。
  acceptance:
    - id: ACC-xiaowei-local-skill-directory-management-001
      text: 带嵌套资源的 Skill 样例安装后资源字节一致、目标权限受限且清单可见；重复安装相同内容是幂等操作，已有不同内容则被拒绝。
      evidence:
        - apps/desktop/tests/local-skill-directory.test.ts
    - id: ACC-xiaowei-local-skill-directory-management-002
      text: 目录穿越、符号链接、特殊文件、缺失或无效的 SKILL.md 元数据，以及文件数或字节数超限均不会留下正式目录或暂存目录。
      evidence:
        - apps/desktop/tests/local-skill-directory.test.ts
    - id: ACC-xiaowei-local-skill-directory-management-003
      text: Electron IPC 与 preload 接口打开原生目录选择器，把源路径和目标路径留在主进程，只返回可安全传给浏览器的清单与结果字段。
      evidence:
        - apps/desktop/tests/ipc-handlers.test.ts
        - apps/desktop/src/preload/index.ts
    - id: ACC-xiaowei-local-skill-directory-management-004
      text: 桌面 Skill 设置区可搜索、刷新和安装目录，同时展示有效与无效的本地条目，并为有效 Skill 显示斜杠命令。
      evidence:
        - apps/desktop/tests/skill-management.test.tsx
        - apps/desktop/src/renderer/features/skill-management/SkillManagementSection.tsx
    - id: ACC-xiaowei-local-skill-directory-management-005
      text: 完整 frontend-slides 目录位于正式安装客户端的运行时目录中，并在正式客户端全新启动后被发现。
      evidence:
        - docs/ops/xiaowei-local-skill-directory-management-acceptance.zh.md
    - id: ACC-xiaowei-local-skill-directory-management-006
      text: 单元测试和组装后的小薇本地配置测试挂载重叠的 Skill 消费器，并证明一次显式手势只产生一条 skill-invocation 指令消息。
      evidence:
        - packages/skill/tool-skill/tests/tool-skill.spec.ts
        - apps/cli/tests/xiaowei-local.snapshot.ts
  evidence:
    - apps/desktop/src/main/local-skill-directory.ts
    - apps/desktop/src/main/ipc-handlers.ts
    - apps/desktop/src/renderer/features/skill-management/index.ts
  decisions:
    - .agents/notes/implemented/feature/2026-08-27-xiaowei-local-skill-directory-management.md
---
# 小薇本地 Skill 目录管理

[English](local-skill-directory-management.md) | 中文

## 结果

小薇桌面端安装完整的本地 Skill 目录，不再把目录缩减成一个 `SKILL.md` 文件。安装后的目录只保留在设备上，重启后继续存在，并在专用设置清单中可见，不依赖某个 Session 是否选择加载或调用它。

## 需求

### REQ-xiaowei-local-skill-directory-management-001

目录选择和复制由原生主进程负责。目标目录从正式 Electron `userData` 目录推导，不能接受任意目标路径；源路径和目标路径不能发送给渲染进程，目录内容也不能上传。

### REQ-xiaowei-local-skill-directory-management-002

安装器接受一个根目录含有效 `SKILL.md` 的目录。它复制除版本库元数据外的嵌套普通文件，拒绝链接和特殊文件，执行固定安全上限，在目标文件系统中暂存，并以原子重命名提交完整且经过校验的目录。已有相同内容时成功但不重复写入；已有不同内容时返回冲突。本版本不覆盖或卸载目录。

### REQ-xiaowei-local-skill-directory-management-003

设置页列出正式本地运行时中已安装的目录，而不是某个 Session 解析后的 Skill 目录。可安全传给浏览器的每行数据包含 Skill 名称、说明、文件数、总字节数、有效状态和无效时的简短错误，且不暴露文件系统路径。

### REQ-xiaowei-local-skill-directory-management-004

现有本地 Skill 文件系统提供方发现原子提交后的目录。用户按现有斜杠命令行为使用 `/<skill-name>` 调用有效 Skill；安装功能不增加第二套执行协议。

### REQ-xiaowei-local-skill-directory-management-005

用户显式调用在一个获准进入的步骤内保持幂等。如果重叠的运行时作用域挂载了多个 Skill 消费器，下游监听器可能先满足该手势；后续监听器会识别已经提出的同名 `skill-invocation` 消息，不再追加另一条持久化指令消息。

## 验收

### ACC-xiaowei-local-skill-directory-management-001

聚焦存储测试安装多层样例，对比资源字节和权限、检查清单、重复安装，并覆盖目标目录冲突。

### ACC-xiaowei-local-skill-directory-management-002

聚焦存储测试覆盖每种被拒绝的文件系统或元数据条件，并确认未留下正式目录或暂存目录。

### ACC-xiaowei-local-skill-directory-management-003

IPC 与 preload 测试证明渲染进程调用不携带文件系统路径，取消操作和可安全传给浏览器的结果字段能够通过桥接。

### ACC-xiaowei-local-skill-directory-management-004

渲染进程测试挂载设置区、筛选清单、刷新数据，并完成一次原生目录安装。

### ACC-xiaowei-local-skill-directory-management-005

正式安装客户端验收检查正式运行时目录、重启已安装应用并读取生效的本地 Skill 清单。源码测试或便携测试包不能满足这一验收项。

### ACC-xiaowei-local-skill-directory-management-006

聚焦的消费者测试与组装后的小薇本地配置快照会挂载重叠的 Skill 消费器，提交一次显式 Skill 手势，并断言获准进入的步骤中恰好包含一条匹配的 `skill-invocation` 消息。

## 决策

只存本地、原生目录选择器的信任边界、原子冲突行为，以及已安装清单与 Session 生效目录之间的区分，记录在[本地 Skill 目录管理 Agent Note](../../../.agents/notes/implemented/feature/2026-08-27-xiaowei-local-skill-directory-management.zh.md)中。
