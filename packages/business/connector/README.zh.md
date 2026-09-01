# Business Connector

[English](README.md) | 中文

定义业务操作使用的已批准连接器与凭证解析接口。

## 模型体验

### 连接器能力

#### 模型看到的内容

没有直接内容。`ctx.businessConnectors` 消费方负责操作 schema 与有界结果展示。

#### Token 影响

没有直接影响；连接器响应只会在消费方校验并展示后影响 token。

#### KV Cache 影响

没有影响。连接器注册与解析不会修改模型上下文。

## 已知限制与后续工作

- R1 阶段连接器仅支持读操作。
