/**
 * Regression for user-clicked links inside the native WebContentsView.
 *
 * Usage:
 *   TEST_BROWSER_URL=http://127.0.0.1:8765 node scripts/e2e-browser-link-navigation.mjs
 */
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_BROWSER_URL || 'http://127.0.0.1:8765';
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

async function embeddedUrl() {
  return app.evaluate(({ webContents }, prefix) => {
    const target = webContents
      .getAllWebContents()
      .find(contents => contents.getURL().startsWith(prefix));
    return target?.getURL() || '';
  }, baseUrl);
}

async function click(selector) {
  return app.evaluate(async ({ webContents }, input) => {
    const target = webContents
      .getAllWebContents()
      .find(contents => contents.getURL().startsWith(input.baseUrl));
    if (!target) throw new Error('embedded browser webContents not found');
    const point = await target.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(input.selector)});
      if (!element) throw new Error('link not found');
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    target.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    target.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }, { baseUrl, selector });
}

async function waitForUrl(pathname) {
  const expected = `${baseUrl}${pathname}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = await embeddedUrl();
    if (current === expected) return current;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return embeddedUrl();
}

try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.workbenchApi), null, {
    timeout: 30_000
  });
  await page.evaluate(async url => {
    await window.workbenchApi.browserSetBounds({
      x: 700,
      y: 120,
      width: 500,
      height: 560
    });
    await window.workbenchApi.browserSetVisible(true);
    await window.workbenchApi.browserNavigate(url);
  }, `${baseUrl}/index.html`);
  assert.equal(await waitForUrl('/index.html'), `${baseUrl}/index.html`);

  await click('#same');
  assert.equal(await waitForUrl('/same.html'), `${baseUrl}/same.html`);

  await page.evaluate(url => window.workbenchApi.browserNavigate(url), `${baseUrl}/index.html`);
  assert.equal(await waitForUrl('/index.html'), `${baseUrl}/index.html`);
  await click('#blank');
  assert.equal(await waitForUrl('/blank.html'), `${baseUrl}/blank.html`);

  await page.evaluate(url => window.workbenchApi.browserNavigate(url), `${baseUrl}/index.html`);
  assert.equal(await waitForUrl('/index.html'), `${baseUrl}/index.html`);
  const beforeCount = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  await app.evaluate(async ({ webContents }, prefix) => {
    const target = webContents
      .getAllWebContents()
      .find(contents => contents.getURL().startsWith(prefix));
    if (!target) throw new Error('embedded browser webContents not found');
    await target.executeJavaScript("window.open('/popup.html', '_blank')");
  }, baseUrl);
  await new Promise(resolve => setTimeout(resolve, 500));
  const afterCount = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  assert.equal(afterCount, beforeCount, 'unsolicited script popups must remain blocked');
  assert.equal(
    await embeddedUrl(),
    `${baseUrl}/index.html`,
    'unsolicited script popups must not replace the current page'
  );

  await click('#popup');
  assert.equal(
    await waitForUrl('/popup.html'),
    `${baseUrl}/popup.html`,
    'a user-clicked script popup should navigate in the current view'
  );

  console.log('browser link navigation: passed');
} finally {
  await app.close();
}
