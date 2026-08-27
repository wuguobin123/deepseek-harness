# document/ — bounded document readers

English | [中文](README.zh.md)

This group owns non-executing parsers for uploaded PDF and modern Office files.

| Package | Role | ctx key |
|---|---|---|
| [`document/`](document/README.md) | Validates PDF, DOCX, XLSX, and PPTX bytes and returns bounded text or worksheet rows | none |

Storage remains owned by [`attachment/`](../attachment/README.md), while model-facing reads and XLSX analysis live in [`web/`](../web/README.md).
