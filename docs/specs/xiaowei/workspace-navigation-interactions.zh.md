---
sdd:
  id: feature.xiaowei.workspace-navigation-interactions
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-workspace-navigation-interactions-001
      text: Grouped workspace navigation always exposes independently collapsible local and cloud sections, including a section with no current workspaces.
    - id: REQ-xiaowei-workspace-navigation-interactions-002
      text: Each location section offers an add action that opens the existing directory flow for that location without changing local-directory or cloud-copy semantics.
    - id: REQ-xiaowei-workspace-navigation-interactions-003
      text: The top workspace header remains a labelled navigation region with search, view options, and a global add menu.
  acceptance:
    - id: ACC-xiaowei-workspace-navigation-interactions-001
      text: Local and cloud disclosure controls hide only their own workspace rows, persist their choices in the browser view store, and expose accessible expanded state.
      evidence:
        - packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
        - packages/client/ui-workspace/tests/tree.client.spec.ts
    - id: ACC-xiaowei-workspace-navigation-interactions-002
      text: Local and cloud add controls open the composed directory flow directly with the matching location and no intermediate menu, while the top add control retains the complete choice menu.
      evidence:
        - packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
        - packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx
    - id: ACC-xiaowei-workspace-navigation-interactions-003
      text: The workspace header and location controls retain compact dimensions, visible interaction feedback, and keyboard focus indicators.
      evidence:
        - packages/client/ui-workspace/tests/browser-styles.client.spec.ts
  evidence:
    - packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx
    - packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css
    - packages/client/ui-workspace/src/client/WorkspacePicker.tsx
  decisions:
    - .agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md
---
# 小薇工作区导航交互

[English](workspace-navigation-interactions.md) | 中文

工作区浏览器会区分设备支撑的本机工作区与账号私有的云端工作区，不改变两者的执行模式。两个位置区头始终可见，会记住是否展开其工作区行；已配置目录流程可用时，添加操作始终可用。

## 交互规则

选择位置标题只会改变该区段工作区行的可见性。选择其添加控件会把位置传给现有目录流程：本机位置打开实时文件夹操作，云端位置打开独立副本操作。顶部“工作区”区头仍是完整导航入口，保留搜索、视图选项和全局添加菜单。

## 验证

组件检查通过组合流程的 owner 字段驱动两种展开状态与两条定向添加路径。Store 与 CSS 检查固定持久化、无障碍状态、紧凑尺寸、悬停反馈和键盘焦点。这些检查证明共享客户端包的行为；已安装的小薇客户端需要单独观察验收。
