// E2E 验证：桌面客户端「自动化任务」功能（每 5 分钟触发 agent_prompt）。
// 使用默认 userData 中已保存的会话凭证，连接凭证指向的后端（生产）。
// 流程：校验账户/环境 → 创建 every=300s 触发器 → 等待首次触发 →
//       验证运行记录 + 结果回传会话 → 禁用触发器清理。
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const EXPECTED_ACCOUNT = process.env.E2E_ACCOUNT ?? 'personal-17b087408b9a43fc';
const PROD_MARK = process.env.E2E_PROD_MARK ?? '119.45.252.25';
const TITLE = `E2E验证·AI热点每5分钟·${new Date().toISOString().slice(11, 16)}`;
const PROMPT =
  '获取 AI 相关热点新闻：请总结 3 条近期 AI 行业热点（标题 + 一句话摘要），用中文简要回答。';
const SHOTS = path.resolve(import.meta.dirname, '../../../docs/screenshots/e2e-automation-prod');
await fs.mkdir(SHOTS, { recursive: true });

// 凭证来源：优先 E2E_CREDS_FILE 指定的已解密明文（standalone keychain 访问
// 异常时使用）；否则用 standalone 辅助进程现场解密本机已存凭证（playwright
// 注入方式启动的实例 safeStorage 解密会失败，属已知启动形态差异）。
const ROOT = path.resolve(import.meta.dirname, '..');
const CREDS_FILE = process.env.E2E_CREDS_FILE
  ? path.resolve(process.env.E2E_CREDS_FILE)
  : path.join(os.tmpdir(), `e2e-creds-${process.pid}.json`);
if (!process.env.E2E_CREDS_FILE) {
  execFileSync(
    path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    [path.join(ROOT, 'scripts/_decrypt-creds.cjs'), CREDS_FILE],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
}
const storedCreds = JSON.parse(await fs.readFile(CREDS_FILE, 'utf8'));
if (storedCreds.tenantId !== EXPECTED_ACCOUNT && storedCreds.actorId !== EXPECTED_ACCOUNT) {
  console.log(`FATAL: 本机凭证账户不符 ${storedCreds.tenantId}/${storedCreds.actorId}`);
  process.exit(1);
}
if (!String(storedCreds.baseUrl).includes(PROD_MARK)) {
  console.log(`FATAL: 本机凭证指向非生产后端 ${storedCreds.baseUrl}`);
  process.exit(1);
}
console.log('[step] credentials-decrypted', JSON.stringify({
  tenantId: storedCreds.tenantId, actorId: storedCreds.actorId, baseUrl: storedCreds.baseUrl
}));

const report = { title: TITLE, steps: [] };
const step = (name, data) => {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(`[step] ${name}`, data ? JSON.stringify(data) : '');
};
const fail = async (page, code, data) => {
  step('FAIL', { code, ...data });
  await page.screenshot({ path: path.join(SHOTS, `fail-${code}.png`) }).catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
};

const app = await electron.launch({
  args: ['.'],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.stack || err)));
  await page.setViewportSize({ width: 1440, height: 960 });

  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    // playwright 启动形态下 safeStorage 读不到已存凭证：改用已解密的凭证走
    // 客户端标准 updateSession 通道（含后端连通性校验）注入，然后重载。
    step('credentials-inject');
    const injected = await page.evaluate(
      (creds) => window.workbenchApi.updateSession({
        apiKey: creds.apiKey,
        tenantId: creds.tenantId,
        actorId: creds.actorId,
        baseUrl: creds.baseUrl
      }),
      storedCreds
    );
    if (!injected?.ok) {
      await fail(page, 'AUTH_INJECT_FAILED', { error: injected?.error });
    } else {
      await page.reload();
      await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
        timeout: 30_000
      });
      if (await page.$('[data-testid="need-credentials"]')) {
        await fail(page, 'AUTH_RELOAD_FAILED');
      }
    }
  }
  if (!(await page.$('[data-testid="need-credentials"]'))) {
    const session = await page.evaluate(() => window.workbenchApi.getSession());
    step('session', session);
    if (session.tenantId !== EXPECTED_ACCOUNT && session.actorId !== EXPECTED_ACCOUNT) {
      await fail(page, 'ACCOUNT_MISMATCH', { session });
    } else if (!String(session.baseUrl).includes(PROD_MARK)) {
      await fail(page, 'NOT_PROD', { baseUrl: session.baseUrl });
    } else {
      // 1. 自动化列表页（创建前）
      await page.getByTestId('nav-automations').click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(SHOTS, '01-automations-before.png') });
      step('automations-page-loaded');

      // 2. 进入新建自动化（triggers 页）
      await page.getByRole('link', { name: '新建自动化' }).click();
      await page.getByTestId('trigger-form').waitFor({ timeout: 10_000 });

      // 3. 填写表单：名称 + prompt + 高级设置（固定间隔 300s）
      await page.getByTestId('trigger-name').fill(TITLE);
      await page.getByTestId('trigger-agent-prompt').fill(PROMPT);
      // 「高级设置」details 默认收起，先展开再操作触发方式
      await page.locator('.advanced-fields summary').click();
      await page.getByTestId('trigger-type').selectOption('every');
      await page.getByTestId('trigger-every-interval').selectOption('300');
      await page.screenshot({ path: path.join(SHOTS, '02-form-filled.png') });
      await page.getByTestId('trigger-submit').click();

      const message = page.getByTestId('triggers-message');
      await message.waitFor({ timeout: 15_000 });
      const messageText = (await message.textContent()) ?? '';
      const triggerId = (messageText.match(/已创建\s+(\S+)/) ?? [])[1] ?? null;
      step('trigger-created', { triggerId, messageText });
      report.triggerId = triggerId;
      if (!triggerId) {
        await fail(page, 'CREATE_FAILED', { messageText });
      } else {
        // 创建后回到自动化列表页确认条目与下次运行时间
        await page.getByTestId('nav-automations').click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(SHOTS, '03-automations-after-create.png') });
        await page.getByRole('link', { name: /管理规则/ }).first().click();
        await page.getByTestId('trigger-table').waitFor({ timeout: 10_000 });

        // 3.5 新建的触发器是 draft 状态，必须在 UI 上手动「启用」才会被调度
        await page.getByTestId(`enable-${triggerId}`).click();
        await page.waitForTimeout(1500);
        const enabledBadge = await page
          .getByTestId(`trigger-row-${triggerId}`)
          .locator('.badge')
          .textContent();
        step('trigger-enabled', { statusBadge: enabledBadge });
        await page.screenshot({ path: path.join(SHOTS, '035-trigger-enabled.png') });

        // 4. 轮询等待首次触发（every=300s，首轮在启用后 ~5 分钟）
        const deadline = Date.now() + 10 * 60_000;
        let firing = null;
        while (Date.now() < deadline && !firing) {
          await page.getByTestId('refresh-triggers').click();
          await page.waitForTimeout(1500);
          firing = await page.evaluate((id) => {
            const rows = [...document.querySelectorAll('[data-testid="trigger-firings"] tbody tr')];
            for (const row of rows) {
              if ((row.textContent ?? '').includes(id)) {
                return {
                  text: (row.textContent ?? '').trim(),
                  status: row.querySelector('.badge')?.textContent ?? null
                };
              }
            }
            return null;
          }, triggerId);
          if (!firing) await page.waitForTimeout(20_000);
        }
        step('first-firing', firing ?? { timeout: true });
        await page.screenshot({ path: path.join(SHOTS, '04-first-firing.png'), fullPage: true });

        // 5. 验证结果回传到自动化会话（assistant 消息出现）
        // preload 只暴露通用 request 通道，直接调 /api/conversations
        let convCheck = null;
        const convDeadline = Date.now() + 5 * 60_000;
        while (Date.now() < convDeadline && !convCheck) {
          const items = await page.evaluate(async () => {
            const res = await window.workbenchApi.request({
              method: 'GET',
              path: '/api/conversations?status=active&limit=50'
            });
            return res.status >= 200 && res.status < 300 ? (res.body?.items ?? []) : [];
          });
          const conv = items.find((c) => String(c.title ?? '').includes('E2E验证'));
          if (conv) {
            const convId = conv.conversationId ?? conv.conversation_id;
            const messages = await page.evaluate(async (id) => {
              const res = await window.workbenchApi.request({
                method: 'GET',
                path: `/api/conversations/${encodeURIComponent(id)}/messages?limit=200`
              });
              return res.status >= 200 && res.status < 300 ? (res.body?.messages ?? []) : [];
            }, convId);
            const assistant = messages.filter((m) => m.role === 'assistant' && (m.content ?? '').trim());
            if (assistant.length > 0) {
              convCheck = {
                conversationId: convId,
                title: conv.title,
                messageCount: messages.length,
                assistantSnippet: assistant.at(-1).content.trim().slice(0, 300)
              };
            }
          }
          if (!convCheck) await page.waitForTimeout(20_000);
        }
        step('conversation-delivery', convCheck ?? { timeout: true });
        report.conversation = convCheck;

        // 在 UI 中打开该会话截图（尽力而为）
        try {
          await page.getByTestId('nav-home').click();
          await page.waitForTimeout(1500);
          await page.getByText('E2E验证', { exact: false }).first().click({ timeout: 8_000 });
          await page.waitForTimeout(2500);
        } catch {
          step('conversation-ui-open', { skipped: true });
        }
        await page.screenshot({ path: path.join(SHOTS, '05-conversation.png') });

        // 6. 清理：禁用触发器，避免继续消耗生产额度
        await page.getByTestId('nav-automations').click();
        await page.waitForTimeout(800);
        await page.getByRole('link', { name: /管理规则/ }).first().click();
        await page.getByTestId('trigger-table').waitFor({ timeout: 10_000 });
        await page.getByTestId(`disable-${triggerId}`).click();
        await page.waitForTimeout(1500);
        const statusBadge = await page
          .getByTestId(`trigger-row-${triggerId}`)
          .locator('.badge')
          .textContent();
        step('trigger-disabled', { statusBadge });
        await page.screenshot({ path: path.join(SHOTS, '06-trigger-disabled.png'), fullPage: true });
      }
    }
  }
  report.pageErrors = pageErrors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  if (!process.env.E2E_CREDS_FILE) await fs.rm(CREDS_FILE, { force: true });
}
