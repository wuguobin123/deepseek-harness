# @deepseek-ai/dsh-llm-account-inference

English | [中文](README.zh.md)

Versioned protocol for session-free account inference. The request is strict and text-only; the authenticated account owner is supplied by the carrier and is never a request field. Responses use versioned NDJSON `chunk`, `done`, and `error` records.
