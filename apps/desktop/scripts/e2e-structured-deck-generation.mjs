/**
 * Real Electron + real backend smoke test for the detached structured-deck path.
 */
import { _electron as electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const screenshots = '../../docs/screenshots/e2e-structured-deck';
mkdirSync(screenshots, { recursive: true });

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
const page = await app.firstWindow();
const startedAt = Date.now();
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    console.log(`[renderer:${message.type()}] ${message.text().slice(0, 500)}`);
  }
});

try {
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
  await page.click('.assistant-new-conversation');
  const existingFilePanelCount = await page.locator(
    '[data-testid="assistant-generated-files"]'
  ).count();
  await page.fill(
    '[data-testid="assistant-input"]',
    '请使用 frontend-slides 技能制作一个 FDE 产品介绍的 PPT，共 12 页。需要右侧 HTML 预览，并提供可下载的 PPTX。直接生成，不需要先询问风格。'
  );
  await page.click('[data-testid="assistant-send"]');
  await page.waitForSelector('[data-testid="assistant-stop"]', { timeout: 10_000 });
  await page.screenshot({ path: `${screenshots}/generation-started.png` });

  await page.waitForSelector('[data-testid="assistant-stop"]', {
    state: 'hidden',
    timeout: 10 * 60_000
  });
  await page.waitForFunction((previousCount) => {
    const panels = document.querySelectorAll('[data-testid="assistant-generated-files"]');
    if (panels.length <= previousCount) return false;
    const panel = panels.item(panels.length - 1);
    const text = panel?.textContent || '';
    return text.includes('.html') && text.includes('.pptx') && text.includes('生成的文件（2）');
  }, existingFilePanelCount, { timeout: 30_000 });
  await page.waitForSelector('[data-testid="browser-panel"]', {
    timeout: 30_000
  });
  await page.waitForFunction(async () => {
    const state = await window.workbenchApi.browserGetState();
    return state.visible && state.mode === 'native' && !state.isLoading &&
      state.artifactDisplayName?.endsWith('.html') && !state.lastError;
  }, undefined, { timeout: 30_000 });
  const previewEvidence = await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((contents) =>
      contents.getURL().startsWith('http://127.0.0.1:8000/api/artifacts/')
    );
    if (!target) return null;
    return target.executeJavaScript(`({
      slideCount: document.querySelectorAll('.slide').length,
      text: document.body.innerText,
      url: location.href
    })`);
  });
  if (!previewEvidence) throw new Error('native browser preview webContents was not found');
  if (previewEvidence.slideCount !== 12) {
    throw new Error(`expected 12 preview slides, got ${previewEvidence.slideCount}`);
  }
  if (!previewEvidence.text.includes('FDE')) throw new Error('preview contains no FDE text');
  const previewPngBase64 = await app.evaluate(async ({ webContents }) => {
    const target = webContents.getAllWebContents().find((contents) =>
      contents.getURL().startsWith('http://127.0.0.1:8000/api/artifacts/')
    );
    if (!target) return null;
    return (await target.capturePage()).toPNG().toString('base64');
  });
  if (!previewPngBase64) throw new Error('native browser preview capture failed');
  writeFileSync(
    `${screenshots}/generation-preview-native.png`,
    Buffer.from(previewPngBase64, 'base64')
  );

  await page.screenshot({ path: `${screenshots}/generation-completed.png` });
  console.log(JSON.stringify({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    slideCount: previewEvidence.slideCount,
    previewChars: previewEvidence.text.length,
    previewUrl: previewEvidence.url
  }));
} finally {
  await app.close();
}
