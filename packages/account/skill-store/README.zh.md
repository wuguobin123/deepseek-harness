# @deepseek-ai/dsh-account-skill-store

[English](README.md) | 中文

为认证账号会话创建的 Skill 提供私有文件系统存储。账号 id 先经过 SHA-256 哈希，绝不直接作为路径段；每个 Skill 写入 `<dshHome>/accounts/<owner-hash>/skills/<name>/SKILL.md`，目录与文件均使用私有权限。

写入会校验 kebab-case 名称和内容大小，拒绝符号链接目标，在同一文件系统中暂存、同步文件并原子重命名。重复写入相同内容是幂等操作；同名但正文不同会报告冲突。

## 模型体验

### 存储服务

#### 模型看到的内容

没有直接模型接口。模型只能通过 `@deepseek-ai/dsh-tool-skill-install` 等 Consumer 使用此存储。

#### Token 影响

没有直接影响。

#### KV Cache 影响

没有直接影响；由 Skill 注册表 Consumer 决定何时投影目录变化。

## 已知限制与暂缓事项

- 当前只创建 Markdown Skill bundle，不创建 `scripts`、`references` 或 `assets` 资源。
- 尚无更新或删除操作；同名内容冲突需要未来显式的生命周期 API。
