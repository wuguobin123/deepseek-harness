# business/ — 账号私有的声明式业务 Skill

[English](README.md) | 中文

本系列按认证账号发布带版本的业务操作清单，并通过一个稳定的模型工具执行有界 HTTPS 请求。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`skill/`](skill/README.zh.md) | 定义清单校验、不可变版本、启用、停用、回滚和账号过滤解析 | `ctx.businessSkills` |
| [`skill-sqlite/`](skill-sqlite/README.zh.md) | 在 SQLite 中持久化账号私有清单和当前生效版本指针 | 提供 `ctx.businessSkills` |
| [`connector/`](connector/README.zh.md) | 定义可信 principal 和命名业务 Connector 解析 | `ctx.businessConnectors` |
| [`connector-http/`](connector-http/README.zh.md) | 使用部署侧凭据引用执行主机白名单内的 HTTPS GET 操作 | 注册到 `ctx.businessConnectors` |
| [`runtime/`](runtime/README.zh.md) | 把生效清单投影到 Skill 目录，并暴露 `business_skill_call` | 注册到 `ctx.skills` 和 `ctx.tools` |
| [`gateway/`](gateway/README.zh.md) | 独立于小薇 Host 执行已评审业务读取并热加载动态授权 | 独立回环服务 |

模型只能提供 Skill 名称、操作和业务输入。Host 从认证 RPC principal 或持久 Session 所有者派生账号。运行时拒绝清单和工具参数中的身份、token、角色与 scope 字段；Connector 添加可信身份和权限请求头，业务服务负责作出最终的操作权限判断。

在小薇具备权威的租户成员关系与租户选择来源之前，不传递 `tenantId`。清单、浏览器请求、用户提示词或模型工具调用都不能提供该字段。
