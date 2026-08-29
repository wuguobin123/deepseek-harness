---
sdd:
  id: feature.xiaowei.desktop-authentication-gate
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-desktop-authentication-gate-001
      text: The desktop restores the durable account state before mounting any local or cloud workspace interface.
    - id: REQ-xiaowei-desktop-authentication-gate-002
      text: A signed-out desktop shows a standalone account page and exposes no workspace, Session, settings, or signed-out local-workspace shortcut.
    - id: REQ-xiaowei-desktop-authentication-gate-003
      text: Sign-in mounts a fresh workbench for that account, while sign-out or an account change disposes the previous workbench before the next account surface becomes usable.
  acceptance:
    - id: ACC-xiaowei-desktop-authentication-gate-001
      text: A signed-out cold start renders the standalone sign-in gate without booting the Cordis workbench; sign-in boots it, and sign-out disposes it and restores the gate.
      evidence:
        - apps/desktop/tests/renderer-entry.test.ts
    - id: ACC-xiaowei-desktop-authentication-gate-002
      text: Signed-out account components contain no control or wording that allows local-workspace access without authentication.
      evidence:
        - apps/desktop/tests/cloud-signin-gate.test.tsx
        - apps/desktop/tests/signin-card.test.tsx
  evidence:
    - apps/desktop/src/renderer/main.new.tsx
    - apps/desktop/src/renderer/features/auth/SignInCard.tsx
    - apps/desktop/src/renderer/features/account/AccountSection.tsx
  decisions:
    - .agents/notes/implemented/architecture/2026-08-24-xiaowei-desktop-auth-gate.md
---
# 小薇桌面端认证门禁

[English](desktop-authentication-gate.md) | 中文

桌面端账号状态控制整个工作台的访问权限，而不只是云端凭证。持久登录态恢复确认账号已经登录前，渲染端不会挂载本机工作区、云端工作区、Session、导航或设置。

## 运行规则

冷启动会先接入认证状态广播，再读取持久账号状态。未登录时只挂载独立账号页面；已登录时为该账号挂载新的 Cordis 工作台。账号变化以用户 ID 为键，因此一个账号不会继承另一个账号已经挂载的客户端上下文。

退出登录会更新共享认证 store、销毁当前 Cordis host，再挂载独立账号页面。内嵌账号组件不提供返回本机工作区的旁路。异步工作台启动完成时，如果其账号键已不等于当前认证状态，该工作台会立即销毁。

## 验证

渲染入口测试通过真实 Zustand 订阅驱动未登录冷启动、登录与退出流程，同时用确定性挂载替代 Cordis host。组件检查固定未登录状态下不存在本机工作区旁路。这些检查证明源码渲染行为；已安装 Electron 客户端与已发布版本需要单独验收。
