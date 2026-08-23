// 诊断探针：设置页"模型与额度"余额不可见问题复现。
// 独立 user-data 启动客户端 → 本地后端注册临时账号 → 打开设置-模型页 →
// 抓取 /api/model-accounts 响应、DOM 状态、console/pageerror。
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'balance-probe-'));
const baseUrl = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:8000';

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', WORKBENCH_API_BASE_URL: baseUrl }
});

try {
  const page = await app.firstWindow();
  const consoleLogs = [];
  const pageErrors = [];
  const apiCalls = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageErrors.push(String(err?.stack || err)));

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', { timeout: 30_000 });
  if (await page.$('[data-testid="need-credentials"]')) {
    await page.getByTestId('account-display-name').fill('BalanceProbe');
    await page.getByTestId('account-email').fill(`balance-probe-${Date.now()}@example.com`);
    await page.getByTestId('account-password').fill('probe-pass-123');
    await page.getByTestId('account-submit').click();
  }
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // 直接在前端调用与 SettingsPage 相同的接口，观察返回
  const apiResult = await page.evaluate(async () => {
    try {
      const { workbenchApi } = await import('/src/renderer/api.ts').catch(() => ({}));
      return { note: 'dynamic import unavailable in packaged renderer' };
    } catch (e) {
      return { error: String(e) };
    }
  });

  await page.getByTestId('nav-settings').click();
  await page.waitForTimeout(1000);

  // 切到"模型与额度"section
  const sectionState = await page.evaluate(() => {
    const testids = [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
    return { testids: testids.filter((t) => /settings|model|nav/.test(t ?? '')) };
  });
  console.log('SECTION_TESTIDS', JSON.stringify(sectionState));

  const modelsTab = await page.$('#nav-settings-models, [data-section="settings-models"], [data-testid="settings-tab-models"]');
  if (modelsTab) await modelsTab.click();
  else {
    // 尝试点击侧栏内文字为“模型”的项
    await page.getByText(/模型与额度|模型/).first().click().catch(() => {});
  }
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="model-accounts"]');
    const balance = document.querySelector('.settings-balance');
    return {
      hasModelCard: Boolean(card),
      balanceText: balance ? balance.textContent : null,
      modelCardText: card ? (card.textContent ?? '').slice(0, 600) : null,
      bodyHasBalanceKeyword: (document.body.textContent ?? '').includes('平台余额')
    };
  });
  console.log('PAGE_STATE', JSON.stringify(state, null, 2));
  console.log('API_EVAL', JSON.stringify(apiResult));
  console.log('CONSOLE', JSON.stringify(consoleLogs.slice(-20), null, 2));
  console.log('PAGEERRORS', JSON.stringify(pageErrors, null, 2));
  await page.screenshot({ path: '/tmp/balance-probe.png' });
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
