/** Real Electron + real backend conversation-driven skill installation (direct install, no confirmation card). */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = '../../docs/screenshots/e2e-skill-install';
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'servicepilot-skill-electron-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    WORKBENCH_API_BASE_URL: 'http://127.0.0.1:8011',
    ELECTRON_ENABLE_LOGGING: '1'
  }
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[renderer:error]', message.text());
});

try {
  await page.waitForSelector('[data-testid="shell"], [data-testid="account-onboarding"]', {
    timeout: 30000
  });
  if (await page.$('[data-testid="account-onboarding"]')) {
    await page.getByTestId('account-advanced').click();
    await page.getByTestId('settings-base-url').fill('http://127.0.0.1:8011');
    await page.getByTestId('settings-api-key').fill('test-key');
    await page.getByTestId('settings-tenant').fill('tenant-a');
    await page.getByTestId('settings-actor').fill('sup-001');
    await page.getByTestId('settings-save').click();
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30000 });
  }
  const input = (await page.$('[data-testid="assistant-input"]'))
    ? '[data-testid="assistant-input"]'
    : '[data-testid="home-assistant-input"]';
  await page.waitForSelector(input, { timeout: 30000 });
  const listInstallations = () =>
    page.evaluate(async () => {
      const response = await window.workbenchApi.request({
        method: 'GET',
        path: '/api/skill-installations'
      });
      return response.body.installations ?? [];
    });
  const baseline = new Set((await listInstallations()).map((item) => item.slug));
  await page.fill(
    input,
    '请搜索并安装用于测试的 demo skill，找到合适版本后直接安装。'
  );
  await page.click('[data-testid="assistant-send"]');
  // 直装语义：不再渲染确认卡片；轮询安装列表直到新 slug 落盘并启用。
  let installed = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('assistant-skill-install-proposal').count()) {
      throw new Error('unexpected manual confirmation card: install must be direct');
    }
    const current = await listInstallations();
    installed = current.find((item) => !baseline.has(item.slug) && item.status === 'enabled');
    if (installed) break;
    await page.waitForTimeout(2000);
  }
  if (!installed) {
    throw new Error('skill was not installed directly within timeout');
  }
  await page.screenshot({ path: `${shots}/02-installed.png` });
  console.log('PASS skill installed directly without confirmation card');
  console.log(`PASS installed slug ${installed.slug} is listed and enabled`);
} finally {
  await app.close();
}
