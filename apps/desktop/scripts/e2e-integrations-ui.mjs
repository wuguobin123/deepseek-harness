import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-integrations-ui-'));
const screenshotPath = process.env.E2E_INTEGRATIONS_SCREENSHOT
  ?? path.resolve(import.meta.dirname, '../../../docs/screenshots/integrations-ui/02-after.png');
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
  if (await page.getByTestId('nav-workflows').count()) {
    throw new Error('workflow navigation should not be present');
  }
  await page.getByTestId('nav-integrations').click();

  const connectorPanel = page.getByTestId('business-connectors');
  await connectorPanel.waitFor({ state: 'visible' });
  if (await page.getByTestId('connector-form').count()) {
    throw new Error('connector form should be collapsed initially');
  }

  await page.getByTestId('connector-add').click();
  await page.getByTestId('connector-form').waitFor({ state: 'visible' });
  await page.getByTestId('connector-add').click();
  await page.getByTestId('connector-form').waitFor({ state: 'detached' });

  await page.getByTestId('integrations-tab-skills').click();
  await page.getByTestId('installed-skills').waitFor({ state: 'visible' });
  if (await connectorPanel.count()) throw new Error('connector panel remained mounted on Skills tab');

  await page.getByTestId('integrations-tab-capabilities').click();
  const catalog = page.getByTestId('capability-catalog');
  await catalog.waitFor({ state: 'visible' });
  await catalog.getByLabel('搜索能力').fill('connector');
  await catalog.getByText(/个结果/).waitFor({ state: 'visible' });

  await page.getByTestId('integrations-tab-connectors').click();
  await page.getByTestId('business-connectors').waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });

  const visiblePanels = await page.locator('[role="tabpanel"]').count();
  if (visiblePanels !== 1) throw new Error(`expected one integration panel, got ${visiblePanels}`);
  console.log(JSON.stringify({ ok: true, screenshotPath, visiblePanels }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
