import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const serviceUrl = process.env.E2E_ACCOUNT_SERVICE_URL ?? 'http://127.0.0.1:8012';
const executablePath = process.env.E2E_DESKTOP_EXECUTABLE;
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-account-ui-'));
const email = `e2e-${Date.now()}@example.com`;
const app = await electron.launch({
  ...(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`] }
    : { args: ['.', `--user-data-dir=${userData}`], cwd: path.resolve(import.meta.dirname, '..') }),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', WORKBENCH_API_BASE_URL: serviceUrl }
});

try {
  const page = await app.firstWindow();
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.getByTestId('account-display-name').fill('端到端用户');
  await page.getByTestId('account-email').fill(email);
  await page.getByTestId('account-password').fill('e2e-safe-password');
  await page.getByTestId('account-submit').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-models').click();
  const modelAccounts = page.getByTestId('model-accounts');
  await modelAccounts.waitFor({ timeout: 20_000 });
  const balance = await modelAccounts.getByText(/¥20\.00/).textContent();
  const session = await page.evaluate(() => window.workbenchApi.getSession());
  if (session.tenantId === 'tenant-a' || !session.actorId.startsWith('usr_')) {
    throw new Error(`server-issued identity was not used: ${JSON.stringify(session)}`);
  }
  await page.getByTestId('settings-tab-account').click();
  await page.getByTestId('account-logout').click();
  await page.getByTestId('account-onboarding').waitFor({ timeout: 20_000 });
  console.log(JSON.stringify({ ok: true, email, balance, session }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
