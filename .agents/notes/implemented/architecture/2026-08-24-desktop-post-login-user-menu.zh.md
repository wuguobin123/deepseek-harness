# Agent Note：桌面账户底栏与版本状态

Status: implemented

[English](2026-08-24-desktop-post-login-user-menu.md) | 中文

## 问题

桌面端在认证后会卸载登录门，因此工作台内看不到当前用户。账户余额虽然可以通过 `account.wallet.get` 读取，却只存在于一个尚未挂载的设置组件中。发布脚本已经生成 `/releases/latest.json`，更新检查器仍始终返回“已是最新”。退出登录也出现在登录组件中，没有稳定且唯一的入口。

## 决策

桌面端在 `sidebar.footer.action` 注册一个部署专属组件，并在 `settings.section` 注册“账户”页面。侧栏先渲染设置，再渲染底栏 action，使头像行位于物理最底部。展开状态显示用户显示名和格式化后的 MiniMax 额度；弹层显示不透明用户 ID、余额和可用客户端版本。收起状态保留头像与更新红点。账户弹层不提供退出操作，唯一可达的退出按钮位于“设置 → 账户”。

账户外壳使用既有 slot ledger，不再创建兄弟 React root。因此它随 Cordis renderer 一起销毁，并直接遵循侧栏展开或窄栏的布局状态。

弹层通过 portal 挂到 `document.body`，同时使用实测坐标固定在底栏旁，从而避开侧栏列有意设置的 `overflow: hidden`。账户卡片使用仅限该 section 的浅色壳样式，避免旧桌面 surface token 在共享设置弹窗中生成深色卡片。

主进程在启动时及之后每四小时拉取并校验 `/releases/latest.json`。它比较当前语义版本、选择当前平台安装包，并通过既有 IPC 发布类型化的 `AppUpdateState`。手动检查会显示当前安装版本是否已是最新，不会再在无可用更新时无可见结果地结束。显式更新操作在 macOS 和 Windows 上执行由主进程固定的安装脚本，renderer 和发布清单都不能传入命令。Linux 保留浏览器下载，且只接受与当前服务地址同源的安装包 URL。

Xiaowei 注册流程通过幂等键 `welcome:<userId>` 一次性发放 `20_000_000` micros。每日刷新仍可配置，但默认值为零。renderer 只读取并展示余额；模型调用的定价与扣款由独立 wallet consumer 负责，因为 wallet 本身无法判断请求使用的是平台 MiniMax 凭证还是 BYOK。

## 备选方案

- 右上角固定兄弟 root 可以复刻参考图中的胶囊，但它脱离侧栏 slot 生命周期，也不符合左下角位置要求。
- 在账户弹层保留退出按钮虽然更近，却会产生第二入口，与“仅设置中退出”的要求冲突。
- 把所有 wallet 余额直接描述为已计量的 MiniMax 消费会夸大实现。provider 选择、token 单价、预留、结算与 BYOK 排除应由专门的模型调用 consumer 处理。

## 影响

用户无需打开设置即可看到当前身份、余额和更新状态。更新检查复用打包流程已经生成的同源版本清单。新账户只获得一次 20 元赠送，不再隐式获得每日赠送。本次展示改动不提供实际 MiniMax token 扣款；启用平台计费的部署必须安装扣款 consumer，之后才能把这项余额描述为受强制执行的消费额度。
