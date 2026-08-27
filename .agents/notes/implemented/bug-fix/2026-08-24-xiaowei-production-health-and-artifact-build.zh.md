# Agent Note: Xiaowei 生产健康检查是已打包路由

Status: implemented

[English](2026-08-24-xiaowei-production-health-and-artifact-build.md) | 中文

## 问题

Xiaowei bundle 将 `/health` 描述为生产存活端点，却没有注册这个精确路由。首次实现还增加了公开的 `./webserver` 导出，却没有为它声明产物入口，因此源码启动能够发现该行，而生产 profile 无法导入 `lib/webserver.js`。部署流程还会复制桌面安装包并下载 Electron，二者都不参与后端运行时。

## 决策

Xiaowei 通过 `src/webserver.ts` 拥有精确的 `/health` 路由。bundle patch 在 HTTP server 之后挂载 `xiaowei-webserver`，并由包内 tsdown 配置生成公开的 `./webserver` 导出。

Xiaowei 部署门禁会在同步前显式生成该包的 TypeScript 与 tsdown 产物。它排除 `apps/desktop`，远端安装跳过 Electron 二进制下载，在重启 Xiaowei 前停止旧 `dsh-ops` 监听器，并仅路由桌面客户端使用的裸 IP authority，不替换旧 nginx 默认 server。该路由返回 `status`、`service: "dsh-xiaowei"` 和进程 uptime。

## 验证

仓库类型检查生成新的 `lib/types/webserver.js` 与 `lib/webserver.js`；Xiaowei profile dump 包含 `xiaowei-webserver` 条目。生产验证确认回环和公网 `/health` 响应均标识 `dsh-xiaowei`，nginx 语法成功，旧服务处于 inactive 状态，SPA 与静态发布 URL 仍可访问。

## 考虑过的替代方案

**将前端 fallback 作为存活检查。** 被拒绝，因为静态 HTML 成功响应不能证明 API carrier 或其精确路由处于运行状态。

**从 bundle patch 引用 TypeScript 源码。** 被拒绝，因为部署通过 `lib/` 中的包导出解析；公开 loader 入口必须有已构建产物。

**让旧服务继续占用同一监听端口。** 被拒绝，因为两个进程不能共同拥有 `127.0.0.1:18000`；显式停止前序服务可使切换状态可观察。

## 后果

生产部署会在替换旧监听器时产生短暂且有意的服务重启窗口。后端发布不再传输桌面源码或安装包，也不会在服务器下载 Electron 运行时。今后的公开 Xiaowei 子路径必须同时具有包导出与构建产物入口。
