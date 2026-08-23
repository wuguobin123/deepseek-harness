/**
 * Real Electron + real backend verification for HTML slides browser preview
 * and rendered PPTX export.
 *
 * Required env:
 *   E2E_HTML_ARTIFACT_ID
 * Optional env:
 *   E2E_HTML_ARTIFACT_NAME (defaults to e2e-frontend-slides.html)
 */
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';

const artifactId = process.env.E2E_HTML_ARTIFACT_ID;
const displayName = process.env.E2E_HTML_ARTIFACT_NAME || 'e2e-frontend-slides.html';
if (!artifactId) throw new Error('E2E_HTML_ARTIFACT_ID is required');

const outputPath = '/tmp/e2e-frontend-slides-export.pptx';
const screenshots = '../../docs/screenshots/e2e-frontend-slides';
mkdirSync(screenshots, { recursive: true });
if (existsSync(outputPath)) unlinkSync(outputPath);

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
const page = await app.firstWindow();
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    console.log(`[renderer:${message.type()}] ${message.text().slice(0, 400)}`);
  }
});

try {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, outputPath);
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    await page.click('[data-testid="settings-save"]');
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30_000 });
  }
  await page.evaluate(() => {
    window.history.pushState({}, '', '/assistant');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForSelector('[data-testid="assistant-page"]', { timeout: 15_000 });

  const opened = await page.evaluate(
    ({ artifactId: id, displayName: name }) =>
      window.workbenchApi.browserOpenArtifact({ artifactId: id, displayName: name }),
    { artifactId, displayName }
  );
  if (!opened.ok) throw new Error(`browser open failed: ${opened.message}`);
  await page.waitForSelector('[data-testid="browser-panel"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="browser-export-pptx"]', { timeout: 15_000 });
  let browserState = await page.evaluate(() => window.workbenchApi.browserGetState());
  const browserDeadline = Date.now() + 30_000;
  const isPreviewUrl = (value) => {
    try {
      return new URL(value).pathname.endsWith('/preview');
    } catch {
      return false;
    }
  };
  while (!isPreviewUrl(browserState.url) && Date.now() < browserDeadline) {
    await page.waitForTimeout(200);
    browserState = await page.evaluate(() => window.workbenchApi.browserGetState());
  }
  if (browserState.artifactId !== artifactId || !isPreviewUrl(browserState.url)) {
    throw new Error(`unexpected browser state: ${JSON.stringify(browserState)}`);
  }
  await page.screenshot({ path: `${screenshots}/browser-preview.png` });
  execFileSync('osascript', ['-e', 'tell application "Electron" to activate']);
  await page.waitForTimeout(500);
  execFileSync('screencapture', ['-x', `${screenshots}/browser-preview-native.png`]);

  await page.click('[data-testid="browser-export-pptx"]');
  await page.waitForFunction(
    () => document.querySelector('.browser-panel__export-message')?.textContent?.includes('已保存到'),
    undefined,
    { timeout: 120_000 }
  );
  if (!existsSync(outputPath) || statSync(outputPath).size < 1_000) {
    throw new Error('exported PPTX was not written or is unexpectedly small');
  }
  await page.screenshot({ path: `${screenshots}/pptx-exported.png` });
  execFileSync('screencapture', ['-x', `${screenshots}/pptx-exported-native.png`]);
  console.log(
    JSON.stringify({
      ok: true,
      artifactId,
      browserUrl: browserState.url,
      outputPath,
      outputBytes: statSync(outputPath).size
    })
  );
} finally {
  await app.close();
}
