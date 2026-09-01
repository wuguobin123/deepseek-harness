# @deepseek-ai/dsh-client-ui-settings-business-skills

[English](README.md) | 中文

该浏览器插件在“设置 → 插件”下增加账号私有的 `business-skills` 页签。页面展示 Skill ID、名称、当前版本、修订号和启停状态，支持编辑 YAML 或 JSON 清单、校验、发布、停用及按修订号回滚版本。操作失败只显示通用提示，不展示传输细节或秘密。

浏览器端通过认证连接调用 `connection.api.businessSkills`。认证、账号归属、清单解析、授权和修订冲突由 Host 负责。

## 模型体验

### 设置界面

#### 模型看到的内容

`business-skills` 设置页签不会注册模型上下文或工具；它只通过认证 RPC 管理定义。

#### Token 影响

浏览器 UI 不贡献 token。

#### KV Cache 影响

没有影响。变更成功后，Host 会刷新 Skill 目录，供后续模型步骤使用。

## 已知限制与后续工作

- 编辑器当前接受原始 YAML 或 JSON；表单化操作 schema 生成与差异审阅暂缓实现。
