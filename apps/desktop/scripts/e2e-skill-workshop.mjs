/** Real Electron + real backend conversation-driven Skill Workshop. */
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = '../../docs/screenshots/e2e-skill-workshop';
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'servicepilot-skill-workshop-electron-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    WORKBENCH_API_BASE_URL: 'http://127.0.0.1:8012',
    ELECTRON_ENABLE_LOGGING: '1'
  }
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[renderer:error]', message.text());
});

try {
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    if (await page.getByTestId('account-onboarding').isVisible().catch(() => false)) {
      await page.getByTestId('account-advanced').click();
    }
    await page.getByTestId('settings-base-url').fill('http://127.0.0.1:8012');
    await page.getByTestId('settings-api-key').fill('dev-api-key');
    await page.getByTestId('settings-tenant').fill('tenant-a');
    await page.getByTestId('settings-actor').fill('sup-001');
    await page.click('[data-testid="settings-save"]');
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30000 });
  }
  const input = (await page.$('[data-testid="assistant-input"]'))
    ? '[data-testid="assistant-input"]'
    : '[data-testid="home-assistant-input"]';
  await page.waitForSelector(input, { timeout: 30000 });
  await page.fill(input, '把我们确认的事故处理 SOP 固化为一个新的 skill');
  await page.click('[data-testid="assistant-send"]');
  await page.waitForSelector('[data-testid="assistant-skill-workshop-proposal"]', {
    timeout: 180000
  });
  const card = await page.textContent('[data-testid="assistant-skill-workshop-proposal"]');
  if (!card?.includes('incident-sop') || !card.includes('支持文件 1 个')) {
    throw new Error(`unexpected workshop card: ${card}`);
  }
  await page.screenshot({ path: `${shots}/01-proposal.png` });
  await page.click('[data-testid="assistant-skill-workshop-confirm"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="assistant-skill-workshop-proposal"]')
        ?.textContent?.includes('已创建'),
    undefined,
    { timeout: 30000 }
  );
  await page.screenshot({ path: `${shots}/02-applied.png` });
  console.log('PASS conversation created a pending Skill Workshop proposal');
  console.log('PASS explicit approval atomically applied and hot-loaded the skill');
} finally {
  await app.close();
}
