import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-release-surface-'));
const screenshotPath = path.join(userData, 'release-onboarding.png');
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.getByTestId('account-advanced').click();
  await page.getByTestId('settings-form').waitFor({ timeout: 10_000 });

  const values = {
    baseUrl: await page.getByTestId('settings-base-url').inputValue(),
    apiKey: await page.getByTestId('settings-api-key').inputValue(),
    tenantId: await page.getByTestId('settings-tenant').inputValue(),
    actorId: await page.getByTestId('settings-actor').inputValue(),
    defaultResetButtons: await page.getByTestId('settings-use-defaults').count()
  };
  if (values.apiKey || values.tenantId || values.actorId) {
    throw new Error(`embedded development credentials remain: ${JSON.stringify(values)}`);
  }
  if (values.defaultResetButtons !== 0) {
    throw new Error('development-default reset is still visible');
  }

  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({ ok: true, values, screenshotPath }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
