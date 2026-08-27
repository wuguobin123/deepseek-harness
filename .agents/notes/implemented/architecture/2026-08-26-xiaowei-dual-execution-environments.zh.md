# Agent Note: 小薇双执行环境

Status: implemented

[English](2026-08-26-xiaowei-dual-execution-environments.md) | 中文

## Problem

生产 Host 无法打开只存在于 Electron 电脑上的目录。把每个选中目录都复制到生产 Host，会让普通本机工作受传输上限影响，产生重复存储，无法实时看到外部修改，并把文件放入与用户选择不一致的执行环境。

## 决策

小薇桌面端在同一渲染器后提供两个显式执行环境。新安装默认使用本机环境，连接桌面端监管的单个 `xiaowei-local` Host；该 Host 绑定操作系统分配的回环端口。云端环境连接配置的生产 Host。Session 和 Workspace 归创建它们的 Host 所有，渲染器不会混用两套标识符。

Electron 选择并规范化本机目录，然后只把路径传给回环 Host 的 `workspace.create` 方法。云端选择继续使用 `workspace.importDirectory`，保留有界序列化、账号所有权、原子发布和导入副本标识。显式环境设置取代通过 `baseUrl` 推断执行位置的做法。

本机 Host 使用 Electron 应用数据目录下独立的 Harness home。它挂载受工作区约束的文件和搜索工具、本机 Skill 发现，以及需要逐次审批的本机 `skill_install` Consumer。在沙箱能够按每个 Session 的工作区推导读写根目录之前，本机环境不挂载同主机 Shell 工具，避免错误承诺隔离能力。

本机模型调用使用本机 Host 保存的模型设置和凭据。模型消息和任务实际选中的工具结果必然会发送给配置的模型提供方，但桌面端不会把目录树上传为云端 Workspace。账号、钱包、更新和云端副本操作继续使用生产 Host。

监管器只接受自身启动子进程发出的就绪信号，且 URL 必须是 `127.0.0.1`。渲染器既不能访问子进程，也不能读取凭据。切换环境时先中止当前下行流，再更换 RPC 目标；应用退出时先请求子进程正常结束，只有超出有界宽限期后才强制终止。

执行环境和云端 `baseUrl` 属于非敏感连接偏好，使用权限为 `0600` 的 JSON 文件原子保存。账号 Session 令牌仍存入 Electron `safeStorage`。因此，切换执行环境不会同步访问操作系统密钥存储，也不会重新加密未变化的账号令牌。

## Alternatives considered

**提高目录上传上限。** 放弃，因为更大的上限仍然带来重复存储、陈旧副本、启动延迟，并错误暗示打开本机目录必须发布到云端。

**让 Agent 在生产 Host 运行，再回调桌面文件工具。** 放弃，因为这会引入双向远程工具协议，让每个云端轮次都依赖桌面在线，并持续授予远程进程调用本机副作用的能力。

**自动向桌面暴露账号模型凭据。** 放弃，因为这会绕过生产钱包结算路径，并在没有显式凭据导出约定的情况下把服务器凭据变成设备凭据。

**原样启用标准本机编码预设。** 放弃，因为其进程级沙箱根目录无法证明多工作区桌面 Host 中每个 Session 都受各自工作区约束。

## 测试

已实现的[功能规格](../../../../docs/specs/xiaowei/local-workspace-environment.zh.md)定义验收 ID。证据覆盖聚焦的路由和监管器测试、组合后的本机运行时测试、现有云端隔离回归、已构建桌面依赖审计，以及针对普通目录的 Electron 安装包运行验收。

- `CI=true pnpm --filter @deepseek-harness/desktop test` 通过 89 项测试，覆盖本机与云端路由、原生目录选择、环境持久化以及未登录云端恢复。
- `CI=true pnpm --filter @deepseek-harness/desktop typecheck` 和 `pnpm --filter @deepseek-harness/desktop build` 通过。
- `CI=true pnpm run test:snapshot -- apps/cli/tests/xiaowei-local.snapshot.ts` 通过无密钥组合预设快照。小薇用例会读取并编辑所选源目录，拒绝路径穿越和符号链接逃逸，不提供 Shell 工具，并在无需重启的情况下安装和发现本机 Skill。
- 账号 Skill、账号 Skill 存储、Workspace 隔离、本机 Skill 和 Profile 解析的聚焦检查共通过 54 项测试。`node scripts/verify-runtime-closure.ts --manifest apps/cli/package.json` 闭合了 4 个预设和 219 个 Workspace 包。
- `pnpm --filter @deepseek-harness/desktop package:mac` 生成了包含自包含本机 Host 的 Electron 35.7.5 Apple Silicon 应用和 DMG。打包应用通过注册 `/private/tmp/xiaowei-packaged-workspace` 打开了包含 6 MiB 文件的目录；其应用数据目录下没有大于 5 MiB 的文件。应用能够无阻塞地完成本机 → 云端 → 本机切换，未登录云端页面提供返回本机入口，并在完整重启后恢复本机环境和 Workspace 注册。

## 后果

本机运行时会增加安装包体积与进程生命周期工作。如果未来没有在保留钱包计费的前提下提供认证模型中继，本机 Session 就不能使用账号的平台模型额度；界面必须解释本机模型配置，不能静默回退到云端执行。被明确放入提示词的文件内容仍会发送给选定的模型提供方。首个版本不提供 Shell 会缩小能力范围，但能够守住已承诺的工作区约束。
