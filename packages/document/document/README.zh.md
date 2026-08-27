# @deepseek-ai/dsh-document

[English](README.md) | 中文

用于 PDF 与现代 Office Open XML 文件的有界读取器。`readDocument` 校验声明的扩展名和媒体类型，拒绝加密或启用宏的压缩包，限制编码及解压后的字节数，并返回页面、章节、幻灯片或工作表单元及简短摘要。`readSpreadsheet` 解析 XLSX 共享字符串与缓存单元格值，形成有界数据行，同时不执行公式、外部链接、宏或嵌入对象。

## 模型体验

### 消费方拥有的解析结果

#### 模型看到的内容

没有该包直接拥有的上下文。`@deepseek-ai/dsh-tool-document` 和 `@deepseek-ai/dsh-tool-sheet` 决定哪些有界解析结果进入模型历史。

#### Token 影响

直接 Token 数为零；消费方工具结果与数据相关，并受各自配置限制。

#### KV 缓存影响

没有直接影响。消费方工具结果决定在已有可复用前缀后追加的数据相关历史。

## 已知限制与待完成工作

- 支持 PDF、DOCX、XLSX 和 PPTX；旧版 DOC、XLS 和 PPT 会被拒绝。
- PDF 仅提取文件内嵌文本；扫描文档需要单独的 OCR 能力。
- XLSX 日期格式和公式计算结果使用工作簿中保存的缓存值，系统绝不会执行公式。
