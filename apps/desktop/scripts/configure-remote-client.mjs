import { _electron as electron } from 'playwright';
import path from 'node:path';

const backendUrl = process.env.WORKBENCH_REMOTE_BACKEND_URL;
const apiKey = process.env.WORKBENCH_REMOTE_API_KEY;
const tenantId = process.env.WORKBENCH_REMOTE_TENANT_ID ?? 'tenant-a';
const actorId = process.env.WORKBENCH_REMOTE_ACTOR_ID ?? 'sup-001';
if (!backendUrl || !apiKey) {
  throw new Error('WORKBENCH_REMOTE_BACKEND_URL and WORKBENCH_REMOTE_API_KEY are required');
}

const app = await electron.launch({
  args: ['.'],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });

  if (await page.getByTestId('shell').isVisible().catch(() => false)) {
    await page.getByTestId('nav-settings').click();
  } else {
    await page.getByTestId('account-advanced').click();
  }
  await page.getByTestId('settings-form').waitFor({ timeout: 10_000 });
  await page.getByTestId('settings-base-url').fill(backendUrl);
  await page.getByTestId('settings-api-key').fill(apiKey);
  await page.getByTestId('settings-tenant').fill(tenantId);
  await page.getByTestId('settings-actor').fill(actorId);
  await page.getByTestId('settings-save').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  const session = await page.evaluate(() => window.workbenchApi.getSession());
  if (
    session.baseUrl.replace(/\/$/, '') !== backendUrl.replace(/\/$/, '') ||
    session.tenantId !== tenantId ||
    session.actorId !== actorId ||
    !session.hasApiKey
  ) {
    throw new Error(`saved session does not match remote target: ${JSON.stringify(session)}`);
  }

  const serviceIndicator = page.locator('.service-status');
  await serviceIndicator.getByText('服务正常').waitFor({ timeout: 30_000 });
  const serviceStatus = await serviceIndicator.textContent();
  const screenshotPath = path.resolve(
    import.meta.dirname,
    '../../../docs/screenshots/e2e-remote-advanced-rag/04-formal-client-connected.png'
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  console.log(
    JSON.stringify({
      ok: true,
      backendUrl: session.baseUrl,
      tenantId: session.tenantId,
      actorId: session.actorId,
      hasApiKey: session.hasApiKey,
      serviceStatus,
      userData,
      screenshotPath
    })
  );
} finally {
  await app.close();
}
