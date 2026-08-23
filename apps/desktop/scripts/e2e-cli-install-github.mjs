/** Real Electron + real backend Q&A installation of GitHub CLI. */
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8012';
const sourceArchive = process.env.CLI_E2E_FIXTURE;
if (!sourceArchive) throw new Error('CLI_E2E_FIXTURE must point to the GitHub CLI source ZIP');

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-install-'));
const fixture = path.join(userData, 'github-cli-source.zip');
await fs.copyFile(sourceArchive, fixture);

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: desktopRoot,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', WORKBENCH_API_BASE_URL: backendUrl }
});

try {
  await app.evaluate(({ dialog }, selectedFile) => {
    // The IPC handler awaits this value; a plain object is valid and avoids
    // Playwright's cross-context Promise lifetime issue in Electron main.
    dialog.showOpenDialog = () => ({ canceled: false, filePaths: [selectedFile] });
  }, fixture);
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"], [data-testid="account-onboarding"]', { timeout: 30_000 });
  if (await page.$('[data-testid="account-onboarding"]')) {
    await page.getByTestId('account-advanced').click();
    await page.getByTestId('settings-base-url').fill(backendUrl);
    await page.getByTestId('settings-api-key').fill('test-key');
    await page.getByTestId('settings-tenant').fill('tenant-a');
    await page.getByTestId('settings-actor').fill('sup-001');
    await page.getByTestId('settings-save').click();
    await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  }

  const input = page.locator('[data-testid="assistant-input"], [data-testid="home-assistant-input"]');
  await page.getByRole('button', { name: '选择文件' }).click();
  await page.locator('.assistant-composer .assistant-attachments').filter({ hasText: 'github-cli-source.zip' }).waitFor({ timeout: 30_000 });
  await input.fill('安装这个 GitHub CLI 命令行工具。');
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(() => {
    const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
    const text = answers.item(answers.length - 1)?.textContent ?? '';
    return text.includes('SHA-256') || text.includes('确认安装');
  }, undefined, { timeout: 180_000 });

  await input.fill('确认安装');
  await page.getByTestId('assistant-send').click();
  // Wait for the second stream to start before waiting for it to finish.  A
  // bare "stop is absent" check races the React state update and can inspect
  // the repository before the sandbox build even starts.
  await page.getByTestId('assistant-stop').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('assistant-stop').waitFor({ state: 'detached', timeout: 600_000 });
  const packages = await page.evaluate(async () => {
    const response = await window.workbenchApi.request({ method: 'GET', path: '/e2e/cli-packages' });
    return response.body?.packages ?? [];
  });
  const gh = packages.find((item) => item.package_id === 'gh' && item.tenant_id === 'tenant-a' && item.actor_id === 'sup-001');
  if (!gh?.binary_path || !gh?.sha256) throw new Error(`GitHub CLI was not installed privately: ${JSON.stringify(packages)}`);
  console.log(JSON.stringify({ ok: true, package: { packageId: gh.package_id, version: gh.version, sha256: gh.sha256 } }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
