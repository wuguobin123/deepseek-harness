import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-settings-ui-'));
const screenshotPath = process.env.E2E_SETTINGS_SCREENSHOT
  ?? path.resolve(import.meta.dirname, '../../../docs/screenshots/settings-ui/current.png');
await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.getByTestId('account-advanced').click();
  await page.getByTestId('settings-save').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-page').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);

  const connectionPanel = page.getByTestId('settings-form');
  await connectionPanel.waitFor({ state: 'visible' });
  await page.getByTestId('settings-tab-models').click();
  await connectionPanel.waitFor({ state: 'detached' });
  const modelPanel = page.getByTestId('model-accounts');
  await modelPanel.waitFor({ state: 'visible' });

  const metrics = await page.getByTestId('settings-page').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const sections = [...element.querySelectorAll('.settings-card')];
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: { width: rect.width, height: rect.height },
      sectionCount: sections.length,
      scrollHeight: document.querySelector('main')?.scrollHeight ?? 0,
      clientHeight: document.querySelector('main')?.clientHeight ?? 0
    };
  });

  const byok = page.locator('.settings-byok');
  await byok.locator('summary').click();
  await byok.locator('input').first().waitFor({ state: 'visible' });
  await byok.locator('summary').click();
  await page.getByTestId('settings-page').scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshotPath });

  if (metrics.sectionCount !== 1) throw new Error(`expected one visible settings card, got ${metrics.sectionCount}`);
  if (metrics.page.height > 900) throw new Error(`settings page is unexpectedly tall: ${metrics.page.height}`);

  await page.getByTestId('settings-tab-account').click();
  await page.getByTestId('account-logout').waitFor({ state: 'visible' });
  await page.getByTestId('settings-tab-connection').click();
  if (await page.getByTestId('account-logout').count()) throw new Error('account content remained mounted after switching tabs');
  console.log(JSON.stringify({ ok: true, screenshotPath, metrics }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
