import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-long-user-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..')
});

try {
  const page = await app.firstWindow();
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.getByTestId('account-advanced').click();
  await page.getByTestId('settings-save').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  const metrics = await page.evaluate(() => {
    const footer = document.querySelector('.sidebar__footer');
    const name = footer?.querySelector('strong');
    const details = footer?.querySelector('div');
    const tenant = footer?.querySelector('.sidebar__tenant');
    if (!(footer && name && details && tenant)) throw new Error('footer nodes missing');
    name.textContent = 'usr_aded9e02446a4a27bb40f502e4146209';
    const tenantLine = footer.querySelector('small');
    if (tenantLine) tenantLine.textContent = 'personal-c2daa76b8d84d80';
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const style = (element) => {
      const value = getComputedStyle(element);
      return {
        display: value.display,
        minWidth: value.minWidth,
        overflow: value.overflow,
        textOverflow: value.textOverflow,
        whiteSpace: value.whiteSpace,
        flexShrink: value.flexShrink
      };
    };
    return {
      footer: rect(footer),
      name: { ...rect(name), ...style(name), scrollWidth: name.scrollWidth },
      details: { ...rect(details), ...style(details) },
      tenant: { ...rect(tenant), ...style(tenant) }
    };
  });

  await page.screenshot({ path: '/tmp/workbench-long-username-layout.png' });
  console.log(JSON.stringify(metrics));
  if (process.env.E2E_ASSERT_LAYOUT === '1') {
    if (metrics.name.textOverflow !== 'ellipsis' || metrics.name.whiteSpace !== 'nowrap') {
      throw new Error(`username is not ellipsized: ${JSON.stringify(metrics.name)}`);
    }
    if (metrics.name.right > metrics.tenant.left || metrics.tenant.right > metrics.footer.right) {
      throw new Error(`footer children overlap: ${JSON.stringify(metrics)}`);
    }
    if (metrics.tenant.height > 18 || metrics.tenant.whiteSpace !== 'nowrap') {
      throw new Error(`tenant badge wrapped: ${JSON.stringify(metrics.tenant)}`);
    }
  }
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
