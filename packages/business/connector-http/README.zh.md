# Business HTTPS Connector

[English](README.md) | 中文

受限 HTTPS GET 连接器，强制批准主机与默认 HTTPS 端口、禁止重定向，并限制超时、JSON 响应和字节数。它从可信 Session 与 manifest 注入 `X-Xiaowei-User-Id` 和 `X-Xiaowei-Required-Permission`，不接受模型输入提供这两个值。

## 模型体验

### HTTPS 连接器

#### 模型看到的内容

没有直接内容。`business_skill_call` 运行时校验并展示成功的 JSON 响应；传输 header、凭据与错误不会进入模型上下文。

#### Token 影响

没有直接影响；只有消费方展示的有界结果可以贡献 token。

#### KV Cache 影响

没有影响。HTTPS 执行不会改变已注册的模型 schema 或 Skill 指引。

## 已知限制与后续工作

- POST 和用户 OAuth 凭证需要单独评审的连接器。
