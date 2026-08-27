# @deepseek-ai/dsh-client-locale

[English](README.md) | 中文

locale 插件：LocaleRuntime 让发布的客户端以中文启动，通过 `locale/change` 发布编程式切换，并在激活时和每次切换时将 `<html lang>` 指向当前 locale（`zh-CN`／`en`）。产品不注册 Language 设置行或 Host locale 设置；浏览器语言与遗留的 `locale.preference` 值都不会改变产品 locale。该服务仍向测试与扩展组合提供 `setLocale`，并拥有 ns×locale 字典注册表（类型化 `register(ns, {zh, en})` 按 `LocaleNamespaceMap` 校验，`bind(ns)`→`TranslateNS<ns>`；查找链 ns → common → en → key）。它实现 slot 系统的 `LocaleFace`，并经 `ctx.slots.installLocale` 自行安装，支撑框架注入的 `t` 标准席位（`Translate`／`TranslateNS` 是 ui-slots 的类型；请从那里导入——本包的再导出仅为字典所有者提供便利）。[固定产品展示决策](../../../.agents/notes/implemented/simplification/2026-08-24-fixed-chinese-light-client.zh.md)负责规定产品默认值和被移除的设置。

## 模型体验

无。locale 注册表为浏览器 UI 文案提供服务；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **部分界面仍保留内联文案**——设置行、侧边栏、问题作答器和模型选择使用 locale seat；其他包仍直接拥有静态文本。
- **注册表持有的文本只读取一次翻译**——在 slot 渲染路径之外于注册时捕获的文案（例如 command 注册表中的 `/model` 命令描述）在重新注册前保持注册时的语言；slot 渲染的文案随切换实时更新。
