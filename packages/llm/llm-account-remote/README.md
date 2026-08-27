# Account remote LLM adapter

English | [中文](README.zh.md)

The device-side `xiaowei-minimax` route delegates `MiniMax-M3` inference to its trusted parent process through Node IPC. Messages are JSON-serializable and carry no bearer token, API key, local session identity, workspace, or filesystem path. The device Agent Loop remains responsible for executing tool calls and sending tool results in later model requests.
