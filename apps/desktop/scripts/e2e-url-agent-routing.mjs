/**
 * Real Electron + real backend regression for URL-bearing conversation input.
 *
 * Verifies that renderer rules do not terminate the turn at browser navigation:
 *   1. URL analysis produces a model answer.
 *   2. A GitHub skill URL is installed directly (no confirmation card) with a
 *      pinned commit version.
 */
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8013';
const screenshots = resolve('../../docs/screenshots/e2e-url-agent-routing');
mkdirSync(screenshots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'workbench-url-routing-electron-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    WORKBENCH_API_BASE_URL: backendUrl,
    ELECTRON_ENABLE_LOGGING: '1'
  }
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[renderer:error]', message.text());
});

async function send(message) {
  const selector = (await page.$('[data-testid="assistant-input"]'))
    ? '[data-testid="assistant-input"]'
    : '[data-testid="home-assistant-input"]';
  await page.fill(selector, message);
  await page.click('[data-testid="assistant-send"]');
}

try {
  await page.waitForLoadState('domcontentloaded');
  const connected = await page.evaluate(
    async ({ baseUrl }) =>
      window.workbenchApi.updateSession({
        baseUrl,
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001'
      }),
    { baseUrl: backendUrl }
  );
  if (!connected.ok) throw new Error(`session setup failed: ${JSON.stringify(connected)}`);
  await page.reload();
  await page.waitForSelector('[data-testid="shell"]', { timeout: 30_000 });

  await send(
    '分析链接 https://github.com/KKKKhazix/khazix-skills/tree/main/hv-analysis 中的这个项目是干嘛的'
  );
  await page.waitForFunction(
    () => {
      const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
      const last = answers.item(answers.length - 1);
      return Boolean(last && !last.querySelector('[data-testid="assistant-stream-status"]'));
    },
    undefined,
    { timeout: 240_000 }
  );
  const analysis = await page.locator('[data-testid="assistant-answer"]').last().innerText();
  if (!/hv-analysis|横纵|深度研究/i.test(analysis)) {
    throw new Error(`analysis answer did not explain the project: ${analysis}`);
  }
  if ((await page.locator('[data-testid="assistant-browser-command"]').count()) !== 0) {
    throw new Error('analysis was intercepted by the legacy browser command path');
  }
  if ((await page.locator('[data-testid="browser-panel"]').count()) !== 0) {
    throw new Error('analysis unexpectedly opened the browser panel');
  }
  await page.screenshot({ path: join(screenshots, '01-url-analysis-answer.png') });

  await send(
    'https://github.com/KKKKhazix/khazix-skills/tree/main/hv-analysis\n安装这个skill'
  );
  // 直装语义：不再渲染确认卡片；轮询安装列表直到 hv-analysis 落盘并启用。
  let installation = null;
  const installDeadline = Date.now() + 240_000;
  while (Date.now() < installDeadline) {
    if ((await page.locator('[data-testid="assistant-skill-install-proposal"]').count()) !== 0) {
      throw new Error('unexpected manual confirmation card: install must be direct');
    }
    const installations = await page.evaluate(async () => {
      const response = await window.workbenchApi.request({
        method: 'GET',
        path: '/api/skill-installations'
      });
      return response.body.installations ?? [];
    });
    installation = installations.find((item) => item.slug === 'hv-analysis');
    if (installation) break;
    await page.waitForTimeout(2000);
  }
  if (!installation) {
    throw new Error('hv-analysis was not installed directly within timeout');
  }
  if (!/[0-9a-f]{40}/.test(String(installation.version ?? ''))) {
    throw new Error(`installation did not record a pinned commit: ${JSON.stringify(installation)}`);
  }
  if ((await page.locator('[data-testid="assistant-browser-command"]').count()) !== 0) {
    throw new Error('install request was intercepted by the legacy browser command path');
  }
  if ((await page.locator('[data-testid="browser-panel"]').count()) !== 0) {
    throw new Error('install request unexpectedly opened the browser panel');
  }
  await page.screenshot({ path: join(screenshots, '02-source-install-proposal.png') });

  console.log('PASS URL analysis reached the conversation agent and returned a semantic answer');
  console.log('PASS GitHub skill URL was installed directly with a pinned commit');
  console.log(`ANALYSIS ${analysis.replace(/\s+/g, ' ').slice(0, 300)}`);
  console.log(`INSTALLATION ${JSON.stringify(installation)}`);
} finally {
  await app.close();
}
