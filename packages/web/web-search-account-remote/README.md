# @deepseek-ai/dsh-web-search-account-remote

English | [中文](README.zh.md)

The `account-remote` `WebSearchProvider` runs in the device Worker and forwards each search to the trusted Electron parent over strict child-process IPC. The wire request contains only `query`, `maxResults`, and `requestId`; credentials, identity, paths, and workspace/session data never cross this link.

The provider supports concurrent requests, cancellation, parent disconnects, and fail-closed handling for malformed or misrouted messages. It returns normalized `dsh-web` results and performs no network request in the Worker. The Xiaowei desktop parent handles the matching IPC messages, applies the current account bearer to `account.web.search`, and validates the cloud response before returning it to the Worker.

## Model Experience

Through `dsh-tool-web`, the model sees the same normalized search sources in local and cloud workspaces. Transport and authentication failures surface as provider errors instead of silently removing the tool.

#### KV Cache effect

Append-only; search sources and provider errors follow the reusable request prefix.

## Known Limitations and Deferred Work

- Search requires an online Xiaowei account session.
- Web Fetch remains device-owned and is not routed through this provider.
