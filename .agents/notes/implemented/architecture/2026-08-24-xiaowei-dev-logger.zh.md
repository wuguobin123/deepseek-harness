# Agent Note: xiaowei 控制台 exporter（dev / CI 日志捕获）

Status: implemented

[English](2026-08-24-xiaowei-dev-logger.md) | 中文

## 问题

xiaowei 多用户 bundle 内置 `LoggingEmailSender`（在没有配 SMTP 时的 dev / CI fallback）。`account.emailCode` 触发时，它会调 `this.logger.warn('email-verification: code sent email=%s code=%s expiresInSeconds=%d', ...)` — 原始的 6 位验证码就在消息体里。桌面客户端要走完整的注册流程：用户填邮箱 + 密码 + 验证码，IPC 桥接调 `account.emailCode` → `account.signup`。问题是：Cordis 的 `LoggerService` 只带一个内存 buffer exporter；没有显式 `ctx.logger.exporter({...})` 注册时，每次 `ctx.logger.*` 调用都被默默丢弃。验证码被写到 /dev/null，用户根本拿不回来，唯一的 fallback 是在 `email-verification.sqlite` 里暴力破解 PBKDF2-HMAC-SHA256(200K 次迭代) 的 hash（salt 16 字节、hash 32 字节、搜索空间 10⁶）—— 单核要 5-10 小时。

不修 vendor code（`vendor/cordis/src/logger.ts`）、不改 `packages/account/email-verification/src/sender.ts` 的前提下，最干净的方案是加一个 Cordis 插件，往现有的 `LoggerService` 上注册一个控制台 exporter。exporter 是 service `exporters` map 上的 per-fiber state；注册一次之后，所有后续 `ctx.logger.warn/info/error` 调用都会迭代这张 map，把消息吐给新的 exporter。

## 决策

新增一个小函数插件 `xiaowei-dev-logger`（`packages/bundle/xiaowei/src/dev-logger.ts`），在 `cordis.patch.yml` 里把它的注册夹在 `xiaowei-startup` 和 `xiaowei-runner` 中间。插件的 `apply(ctx)` 调：

```ts ignore-check
ctx.logger.exporter({
  colors: false,
  levels: { default: 3 }, // LoggerLevel.DEBUG = 3 — emit every severity
  maxLength: 8192,
  export(message) {
    process.stderr.write(`[${ts}] [${type}] ${name}: ${formatted}\n`)
  },
})
```

`levels.default` 是 exporter 接受的*最低*严重度——Cordis 的过滤是 `if (targetLevel < level) continue`。设成 `LoggerLevel.DEBUG (3)`，每个严重度都能过；设成 `0`（最显而易见的「最低级别」）反而会跳过 INFO 和 WARN，验证码直接被吞掉。第一版我把 `default` 设成 `0`，exporter 注册了但从未触发——这个 bug 之所以能浮出来，是因为 dev / CI 流程要的是真的能从日志里读到验证码，而不仅仅是「exporter 注册成功」。

exporter 通过 `Logger.format(exporter, message)` 格式化每条记录，往 `process.stderr` 写一行。选 stderr 而不是 stdout，因为 stdout 是 `dsh-xiaowei` 结构化 CLI 输出的专用通道（一次性任务那条路），systemd / launchd 的日志路由默认走 stderr。bundle 启动时 `nohup ... >log 2>&1` 把两个 fd 折到一个文件里。

插件由 `XIAOWEI_CONSOLE_LOGGER` 守门（当前默认 `true`）。等 bundle 真的把 SMTP 运到生产时，运维可以把 env 设成 `false`，退回到静音的内存 buffer。开关在 JSDoc 里写明，常量写在 `apply()` 旁边，下次想找就一个 grep 的事。

`package.json` 的 `exports` 加上 `./dev-logger`（mirror `./startup` 和 `./invariant` 的形式）。cordis patch 行指向新加的 export。编译出的 `lib/dev-logger.js` 和 `lib/dev-logger.d.ts` 由 `tsc -p tsconfig.json` 生成，然后照 `startup.js` 现有的 build 模式拷一份到 package 根目录——xiaowei bundle 同时跑 `lib/types/*.js`（类型感知 emit）和 `lib/*.js`（runtime 解析）。

## 候选方案

**改 `LoggingEmailSender.sendVerificationCode`，直接 `console.error`。** 在现有 `this.logger.warn(...)` 上面叠一行 stderr 写就能让验证码进日志。这个 seam 属于 `sender.ts`（定义契约的那个包），但 SmtpEmailSender 和任何未来的 EmailSender 实现也都得加同样的 stderr fallback——结构上就是在每个 sender 实现里硬塞 dev 设施。xiaowei bundle 才是面向 dev 的表面，dev 设施应该住在那里，不是 account seam 里。`EmailSender` 包现在也不 import Node 的 `process`；为了一个 dev fallback 把 stdlib 引用拉进来，契约就糊了。

**在 `xiaowei-startup.ts` 里注册控制台 exporter。** startup 是一个 50 行的插件，唯一职责是解析 CLI args、发布 `XIAOWEI_STARTUP_SERVICE`。在它里面塞 logger 注册，等于把 lifecycle 和可观测性混在一起。将来 PR 砍掉一次性任务那条路（xiaowei 跑成常驻多用户服务）时，要么删掉注册、要么再搬一次。分开成独立插件，每个文件的目的都更可搜。

**在 `cordis.patch.yml` 加一个 `console` logger 行，挂一个内建 service 持有 exporter。** Cordis 没有内建 console exporter；要造一个，要么动 vendor code（`vendor/cordis/src/logger.ts`），要么单出一个 `@deepseek-ai/cordis-plugin-console-logger` 包。不管哪种方案，console exporter 都成了「框架的一部分」，这是错的：它是 xiaowei 的 dev 设施，不是 Cordis 的特性。Bundle 内部的函数插件才是它该住的地方。

**用 `process.stdout.write` 而不是 `process.stderr.write`。** stdout 是约定俗成的 CLI 表面；xiaowei runner 把 `runTask` 的结果文本写到那里。把日志记录和任务输出混在一起，会坏掉任何下游 grep stdout 找运行结果的工具。stderr 才是诊断信息该走的地方——systemd、launchd 和大多数日志聚合器默认路由 stderr，stdout 留给任务契约承诺的 API。

**把 `levels.default` 设成 `LoggerLevel.INFO (1)`，靠 logger 自己的默认级别往上抬。** xiaowei 进程没继承任何 logger intercept config，所以 logger 自身的 `level` 默认 INFO。过滤逻辑读 `exporter.levels?.[name] ?? exporter.levels?.default ?? logger.level ?? INFO`。设 `default: 1` 会跳过 DEBUG；设 `default: 3`（DEBUG）让每个严重度都过。第一版我把 `default` 设成 `0`，以为「最低级别 = 啥都发」；Cordis 的过滤是反过来的——`targetLevel < level` 意思是「exporter 能接受的级别低于当前调用级别时跳过」。只有选 `DEBUG` 才是「啥都发、且不用逐个 name 覆盖」的值。

## 影响

新用户的 `account.emailCode` 现在会把原始 6 位验证码写到 xiaowei 的 stderr / 日志文件（dev 流程里就是 `/tmp/dsh-xiaowei.log`）。CDP 探针（`apps/desktop/desktop-signup-flow.mjs`）tail 日志抓 `code=(\d{6})`，取最新一条匹配，填进 SignInCard 的验证码字段（通过 `window.workbenchApi.signUp`），然后确认 `auth-state-after` 翻成 `signedIn:true` 且 `userId` 非空。整条链——`requestEmailCode` → 日志抓码 → `signUp` → 后续 `getAuthState`——端到端 ~1.5s。后续状态显示 `wallet.get` 是 `balanceMicros: 20_000_000`（20 元 welcome bonus），`host.describe` 带着 `api-client.setToken` 注入的 bearer 头成功通过。signin-gate 卸载，Cordis sidebar shell 接管；`data-slot="sidebar"` workspace picker 带着 brand 行渲染起来。

`XIAOWEI_CONSOLE_LOGGER` env 当前默认开着。生产部署如果配了 `XIAOWEI_SMTP_HOST`，应该同步设 `XIAOWEI_CONSOLE_LOGGER=false`，避免验证码进运维日志——这点在 JSDoc 里写了。等审计追踪的产品形态定下来，下一轮 PR 可以加 per-name 级别覆盖（`levels: { 'email-verification': 0 }`，丢掉原始码但保留审计消息）。

exporter 是 per-process——每次 xiaowei 启动都重注册，每次关停都通过标准 `ctx.effect()` disposer 路径清理。`cordis.patch.yml` 的注册顺序把它排在 `xiaowei-startup`（发布 bind port + task）之后、`xiaowei-runner`（跑可选的前台任务）之前。未来任何想在自己的 `apply()` 里打日志的插件，都可以假定挂载时 exporter 已经活了。

`vendor/cordis/src/logger.ts` 没动——零 vendored 修改。`LoggingEmailSender` 也没动。bundle patch 行的形状照搬 `xiaowei-startup` 那行，所以以后想加新的 dev 插件，复制这一行当模板就行。
