# 本地 Skill 目录管理验收

[English](xiaowei-local-skill-directory-management-acceptance.md) | 中文

日期：2026-08-27

## 源码闸门

桌面包通过了 `pnpm --filter @deepseek-harness/desktop typecheck`、包含 23 个文件和 123 项测试的完整 Vitest 套件、无错误的 ESLint，以及生产 `build:main` 和 `build:renderer` 路径。已有的 `es2024` 目标和包体积提示仍然只是警告。

聚焦测试覆盖完整嵌套目录安装、排除 `.git`、私有权限、owner 执行权限、相同内容幂等、不同内容冲突、链接、无效元数据、文件大小上限、暂存清理、可安全传给浏览器的清单、只由原生目录选择器驱动的 IPC、取消、搜索、刷新，以及从设置区安装目录。

## 正式客户端数据

本次验收选择的完整目录通过 `LocalSkillDirectoryManager` 安装到正式 macOS 桌面数据根目录下的 `~/Library/Application Support/@deepseek-harness/desktop/local-runtime/skills/frontend-slides`。安装前目标目录不存在。

安装器返回 `status: installed`、`fileCount: 163` 和 `totalBytes: 3532176`。排除 `.git` 后，目标与源目录的递归内容比较没有差异。目标中不存在链接、特殊文件、`.git`、暂存目录或安装锁。根目录权限为 `0700`，`SKILL.md` 为 `0600`，源目录中的可执行脚本为 `0700`。

## 已安装运行时发现

探针使用正式桌面数据根目录启动了 `/Applications/小薇.app` 0.3.27 内置的 `xiaowei-device-runtime.mjs`，创建空白 Session `session-536877c1-f76b-4f74-8c84-578857471d56`，并通过该打包运行时的 HTTP RPC 路径调用 `skill.list`。响应包含完整说明的 `frontend-slides`，且 `modelInvocable: true`。

这些证据证明正式数据安装和打包运行时发现已经成立。新的设置清单已完成源码构建和测试，但尚未进入当前安装的 0.3.27 应用；只有在后续桌面打包和发布得到明确授权后，它才成为正式安装客户端中的行为。
