# @deepseek-ai/dsh-llm-account-inference

[English](README.md) | 中文

无 Session 的账号推理版本化协议。请求严格限制为文本内容，账号所有者由认证传输层提供，不出现在请求字段中；响应使用带版本号的 NDJSON `chunk`、`done`、`error` 记录。
