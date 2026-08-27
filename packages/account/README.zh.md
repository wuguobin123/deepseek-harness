# 账号包

[English](README.md) | 中文

小薇多用户 Host 使用的认证账号能力。服务端 API 从认证 principal 或持久会话 owner 派生账号；浏览器与模型 payload 不能选择其他账号。

| 包 | Context 键／职责 |
|---|---|
| `account-identity` | `ctx.identity`：仅限分享码的注册、每个所有者三个传播码、100 个账号上限、登录与不透明会话 |
| `account-email-verification` | `ctx.emailVerification`：按用途和分享码绑定的验证码生命周期 |
| `account-model-keys` | 账号模型凭据与撤销 |
| `account-wallet` | 账号余额与流水 |
| `account-plugin-factory` | `ctx.accountPluginFactory`：插件目录与安装状态 |
| `account-skill-store` | `ctx.accountSkillStore`：私有 Skill 发布 |
| `tool-skill-install` | 对话式 Skill 安装的模型 Consumer |

账号持久化必须以权威 user id 为每条可变记录建立键。系统默认能力仍由部署拥有，所有账号无需创建用户记录即可读取。
