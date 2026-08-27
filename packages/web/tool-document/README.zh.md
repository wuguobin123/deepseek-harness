# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

`document_read` 从当前会话已记录的 PDF、DOCX、XLSX 或 PPTX 附件中读取有界文本。工具只接收不透明的 `attachmentId`；读取存储前，它会从持久 `user/message` 来源元数据中解析完整引用，因此模型无法伪造指向其他会话文件的引用。

## 模型体验

### 系统提示词

#### 模型看到的内容

固定指引把 `document_read` 限制在当前会话文件，说明基于游标的单元读取，并明确不解释公式、宏、链接、嵌入文件、OCR 和旧版二进制 Office 格式。

##### 文档读取指引

```markdown
Use document_read only for a file attached to the current session. Read one page, slide, worksheet, or a bounded cursor range; formulas, macros, links, embedded files, OCR, and binary legacy Office formats are not executed or interpreted.
```

#### Token 影响

插件挂载期间保持固定。

#### KV 缓存影响

插件与指引文本不变时保持前缀稳定。

### 工具 schema 与结果

#### 模型看到的内容

生成的 [`document_read` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-document) 接受附件 ID 和可选游标。成功结果包含经校验的元数据、有界摘要和单元，并在仍有后续单元时包含下一游标；归属或解析失败只返回错误，不返回文件字节。

#### Token 影响

schema 成本固定；每次结果与数据相关，并受 `maxCharacters` 和游标限制。

#### KV 缓存影响

结果追加在可复用请求前缀之后；配置、schema 或工具可见性变化可能从变化的定义处使复用失效。

## 已知限制与待完成工作

- 不提供 OCR 和扫描 PDF 识别。
- 不解释或接受公式、链接、宏、嵌入对象、加密文件和旧版二进制 Office 文件。
