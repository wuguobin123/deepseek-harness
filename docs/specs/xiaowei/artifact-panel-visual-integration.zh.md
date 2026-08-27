---
sdd:
  id: feature.xiaowei.artifact-panel-visual-integration
  kind: feature
  status: implemented
  owners:
    - xiaowei-desktop
  requirements:
    - id: REQ-xiaowei-artifact-panel-visual-integration-001
      text: The artifact viewer uses the shared client theme tokens and presents one continuous details surface without repeating the outer panel title or border.
    - id: REQ-xiaowei-artifact-panel-visual-integration-002
      text: The active artifact identity, browser handoff, full-screen preview, download, and refresh remain available in a narrow details column without a text-heavy toolbar.
    - id: REQ-xiaowei-artifact-panel-visual-integration-003
      text: The artifact list, selected item, transient status, and preview canvas have distinct visual hierarchy in both light and dark themes.
    - id: REQ-xiaowei-artifact-panel-visual-integration-004
      text: A self-contained HTML artifact preserves a desktop-width layout in the narrow details column by fitting an isolated preview viewport to the available canvas, while full-screen preview uses the available native width and the no-network sandbox policy remains unchanged.
    - id: REQ-xiaowei-artifact-panel-visual-integration-005
      text: The packaged desktop loads active HTML artifacts from an independently served, re-authorized preview document whose CSP permits self-contained scripts while denying network access, without weakening the renderer CSP.
  acceptance:
    - id: ACC-xiaowei-artifact-panel-visual-integration-001
      text: A focused component check proves that artifact mode owns an edge-to-edge details body while ordinary tool details retain their padded scrolling body.
      evidence:
        - packages/client/ui-conversation/tests/gate-branch-tails.client.spec.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-002
      text: A focused desktop check proves the compact labeled controls, selected-item semantics, artifact count, and existing preview actions.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-003
      text: The desktop styles use shared client theme aliases for the panel, list, status, preview, and transcript artifact cards.
      evidence:
        - apps/desktop/src/renderer/styles.css
        - packages/client/ui-conversation/src/client/skeleton/DetailsPanel.module.css
    - id: ACC-xiaowei-artifact-panel-visual-integration-004
      text: A focused desktop check proves that a narrow HTML canvas receives a desktop-width iframe viewport scaled to fit, a wide canvas remains unscaled, and the sandbox continues to deny network access.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
        - apps/desktop/src/renderer/features/document-preview/DocumentPreview.tsx
    - id: ACC-xiaowei-artifact-panel-visual-integration-005
      text: Focused desktop checks prove that the packaged renderer uses the artifact preview protocol, each request re-authorizes and validates an HTML artifact, malformed or non-HTML requests fail closed, and the response is non-cacheable with the no-network artifact CSP.
      evidence:
        - apps/desktop/tests/artifact-preview.test.tsx
        - apps/desktop/src/main/artifact-preview-protocol.ts
        - apps/desktop/src/main/index.ts
  evidence:
    - apps/desktop/src/renderer/features/document-preview/DocumentPreviewPanel.tsx
    - packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx
  decisions:
    - .agents/notes/implemented/feature/2026-08-24-xiaowei-artifact-registry.md
---
# 小薇产物面板视觉融合

[English](artifact-panel-visual-integration.md) | 中文

产物查看器属于现有的对话详情栏。详情栏标题只命名一次该界面，查看器填满内容区，不再增加第二层面板边框。

## 展示规则

选中产物摘要与纯图标操作组成一条紧凑工具栏。每个操作保留可见提示和无障碍标签。列表显示产物数量，使用克制的选中态，并在不引入深色嵌套界面的前提下分隔导航与预览画布。

所有颜色、边框、悬停状态和状态提示都使用共享的 `--dsw-*` 别名。因此，同一组件会跟随当前的浅色或深色主题，不再携带桌面端专用配色。

## HTML 预览尺寸

详情栏可能比生成式仪表盘预设的布局宽度更窄。HTML 查看器因此把 960 个 CSS 像素作为隔离页面视口的最小宽度，再将 iframe 等比缩放到可用预览画布。缩放后的 iframe 会获得按比例增大的视口高度，因此页面自身的滚动与指针交互仍然可用，内容不会被裁剪。当画布宽度达到 960 像素及以上时，包括覆盖应用框架的全屏预览，iframe 直接使用可用原生尺寸，不再缩放。

该适配只改变预览尺寸。既有 iframe 沙箱与注入的无网络内容安全策略保持不变，因此适配页面不会获得远程资源访问能力或父文档权限。

## HTML 预览隔离

打包后的桌面端通过 `xiaowei-artifact://preview/<artifact-id>` 加载 HTML。主进程重新执行已授权的产物读取，校验返回的 id、媒体类型、字节数与 base64 字节，然后返回禁止缓存且带受限产物 CSP 的独立 HTML 响应。这份独立响应允许产物自包含的内联图表或幻灯片运行时执行，不会继承渲染器更严格的 `script-src 'self'` 策略。渲染器 CSP 只向该协议放行 frame 导航，自身脚本策略不变。浏览器开发环境保留既有的沙箱 `srcDoc` 回退。

## 验证

聚焦的客户端和桌面端组件检查覆盖详情内容区归属、标签、选中语义、数量、操作、预览尺寸和协议失败行为。桌面端渲染器构建验证集成后的样式、CSP 声明和组件导入。
