import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-product-e2e-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (await page.getByTestId('need-credentials').isVisible().catch(() => false)) {
    if (await page.getByTestId('account-onboarding').isVisible().catch(() => false)) {
      await page.getByTestId('account-advanced').click();
    }
    await page.getByTestId('settings-base-url').fill('http://127.0.0.1:8000');
    await page.getByTestId('settings-api-key').fill('dev-api-key');
    await page.getByTestId('settings-tenant').fill('tenant-a');
    await page.getByTestId('settings-actor').fill('sup-001');
    await page.getByTestId('settings-save').click();
  }
  await page.getByTestId('shell').waitFor({ timeout: 20_000 });

  await page.getByTestId('nav-integrations').click();
  await page.getByTestId('business-connectors').waitFor();
  await page.getByTestId('connector-add').click();
  await page.getByTestId('connector-form').getByLabel('连接名称').fill('E2E CRM');
  await page.getByTestId('connector-form').getByLabel('服务地址').fill('https://crm.example.com/api');
  await page.getByTestId('connector-form').getByLabel('认证方式').selectOption('none');
  await page.getByTestId('connector-form').getByRole('button', { name: '保存连接' }).click();
  await page.getByText('E2E CRM', { exact: true }).waitFor();

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-models').click();
  await page.getByTestId('model-accounts').waitFor();
  const balance = await page.getByTestId('model-accounts').getByText(/¥20\.00/).textContent();

  await page.getByTestId('nav-automations').click();
  await page.getByText('自动化').first().waitFor();

  await page.evaluate(async () => {
    const connectors = await window.workbenchApi.request({ method: 'GET', path: '/api/connectors' });
    for (const connector of connectors.body.connectors.filter((item) => item.displayName === 'E2E CRM')) {
      await window.workbenchApi.request({ method: 'DELETE', path: `/api/connectors/${connector.connectorId}` });
    }
  });

  console.log(JSON.stringify({ ok: true, balance, userData }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
