# document/：有界文档读取器

[English](README.md) | 中文

本组负责不执行上传内容的 PDF 与现代 Office 文件解析器。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`document/`](document/README.zh.md) | 校验 PDF、DOCX、XLSX 和 PPTX 字节，并返回有界文本或工作表数据行 | 无 |

存储仍由 [`attachment/`](../attachment/README.zh.md) 负责，面向模型的读取与 XLSX 分析位于 [`web/`](../web/README.zh.md)。
