/** Verify that the TencentOS workbench host bypasses the system proxy. */
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';

const url = 'http://119.45.252.25:18080/health';
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.workbenchApi), null, { timeout: 30_000 });
  await page.evaluate(async target => {
    await window.workbenchApi.browserSetBounds({ x: 680, y: 100, width: 560, height: 620 });
    await window.workbenchApi.browserSetVisible(true);
    await window.workbenchApi.browserNavigate(target);
  }, url);

  const deadline = Date.now() + 15_000;
  let observed = null;
  while (Date.now() < deadline) {
    observed = await app.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(item =>
        item.getURL() === target || item.getURL().includes('webblock.html')
      );
      if (!contents) return null;
      return {
        url: contents.getURL(),
        proxy: await contents.session.resolveProxy(target),
        body: await contents.executeJavaScript('document.body?.innerText || ""')
      };
    }, url);
    if (observed?.body || observed?.url.includes('webblock.html')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  console.log(`proxy-bypass-observed=${JSON.stringify(observed)}`);
  assert.ok(observed, 'embedded browser did not produce a page');
  assert.match(observed.proxy, /^DIRECT$/);
  assert.equal(observed.url, url);
  assert.match(observed.body, /status|ok|healthy/i);

  const publicUrl = 'https://news.baidu.com/';
  await page.evaluate(target => window.workbenchApi.browserNavigate(target), publicUrl);
  const restoredProxy = await app.evaluate(async ({ webContents }, target) => {
    const contents = webContents.getAllWebContents().find(item => /^https?:/.test(item.getURL()));
    if (!contents) throw new Error('embedded browser webContents not found');
    return contents.session.resolveProxy(target);
  }, publicUrl);
  console.log(`proxy-restored=${restoredProxy}`);
  assert.doesNotMatch(restoredProxy, /^DIRECT$/);
} finally {
  await app.close();
}
