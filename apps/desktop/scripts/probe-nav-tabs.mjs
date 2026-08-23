// 诊断探针：逐一点击侧边栏 tab，抓取渲染端 console / pageerror 与 main 区域内容状态。
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = process.env.PROBE_USER_DATA ?? null;

const app = await electron.launch({
  args: userData ? ['.', `--user-data-dir=${userData}`] : ['.'],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    WORKBENCH_API_BASE_URL: process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:8000'
  }
});

try {
  const page = await app.firstWindow();
  const consoleLogs = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageErrors.push(String(err?.stack || err)));

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', { timeout: 30_000 });
  if (await page.$('[data-testid="need-credentials"]')) {
    // 注册一个本地临时账号完成登录（后端地址由 WORKBENCH_API_BASE_URL 注入）
    await page.getByTestId('account-display-name').fill('Probe');
    await page.getByTestId('account-email').fill(`probe-${Date.now()}@example.com`);
    await page.getByTestId('account-password').fill('probe-pass-123');
    // 验证码输入框是 required + pattern="\d{6}"，不填浏览器表单校验直接拦下提交。
    // 填占位码满足前端校验；要求探针后端以 APP_ACCOUNT_EMAIL_VERIFICATION_REQUIRED=false
    // 启动（required=false 时服务端完全跳过验证码校验，不验码值）。
    if (await page.$('[data-testid="account-verification-code"]')) {
      await page.getByTestId('account-verification-code').fill('000000');
    }
    await page.getByTestId('account-submit').click();
  }
  await page.getByTestId('shell').waitFor({ timeout: 30_000 }).catch(async (err) => {
    const dump = await page.evaluate(() => ({
      url: window.location.href,
      testids: [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')).slice(0, 40),
      bodyText: (document.body.textContent ?? '').trim().slice(0, 500)
    }));
    console.log('SHELL_WAIT_FAILED', JSON.stringify({ dump, consoleLogs, pageErrors }, null, 2));
    throw err;
  });
  await page.waitForTimeout(1500);

  const report = { initialUrl: await page.evaluate(() => window.location.href), tabs: [] };

  const navs = ['nav-home', 'nav-tasks', 'nav-approvals', 'nav-knowledge', 'nav-integrations', 'nav-automations', 'nav-settings'];
  for (const nav of navs) {
    await page.getByTestId(nav).click();
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="main"]');
      return {
        url: window.location.href,
        mainChildCount: main?.childElementCount ?? -1,
        mainTextLen: (main?.textContent ?? '').trim().length,
        mainFirstTestId: main?.firstElementChild?.getAttribute('data-testid') ?? null,
        mainHtmlSnippet: (main?.innerHTML ?? '').slice(0, 200)
      };
    });
    report.tabs.push({ nav, ...state });
  }

  report.pageErrors = pageErrors;
  report.consoleErrors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[warning]'));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
