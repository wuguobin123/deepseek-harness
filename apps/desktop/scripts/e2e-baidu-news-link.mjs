/** Reproduce a user-gesture headline click on https://news.baidu.com/. */
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';

const startUrl = 'https://news.baidu.com/';
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.workbenchApi), null, { timeout: 30_000 });
  await page.evaluate(async url => {
    await window.workbenchApi.browserSetBounds({ x: 680, y: 100, width: 560, height: 620 });
    await window.workbenchApi.browserSetVisible(true);
    await window.workbenchApi.browserNavigate(url);
  }, startUrl);

  let headline;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    headline = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      if (!contents) return null;
      return contents.executeJavaScript(`(() => {
        const anchor = Array.from(document.querySelectorAll('a.a3[href]')).find(element => {
          const rect = element.getBoundingClientRect();
          const href = element.href || '';
          return rect.width > 80 && rect.height > 12 && /^https?:/.test(href);
        });
        if (!anchor) return null;
        const rect = anchor.getBoundingClientRect();
        return {
          text: anchor.textContent.trim(), href: anchor.href,
          targetAttribute: anchor.getAttribute('target'), targetProperty: anchor.target,
          routerInstalled: window.__workbenchLinkRouterInstalled === true,
          routeCurrent: anchor.getAttribute('data-workbench-route-current'),
          blankTargetCount: document.querySelectorAll('a[target="_blank"]').length,
          point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
        };
      })()`);
    }, startUrl);
    if (headline?.routerInstalled && headline?.routeCurrent === 'true') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(headline, 'visible Baidu News headline not found');
  console.log(`headline-before=${JSON.stringify(headline)}`);

  await app.evaluate(async ({ webContents }, input) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL() === input.url);
    if (!contents) throw new Error('Baidu News webContents not found');
    await contents.executeJavaScript(`(() => {
      const anchor = Array.from(document.querySelectorAll('a[href]'))
        .find(element => element.href === ${JSON.stringify(input.href)});
      if (!anchor) throw new Error('headline moved out of the document');
      anchor.scrollIntoView({ block: 'center' });
      anchor.click();
    })()`, true);
  }, { url: startUrl, href: headline.href });

  await new Promise(resolve => setTimeout(resolve, 3_000));
  const after = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .map(item => ({ type: item.getType(), url: item.getURL(), title: item.getTitle() })));
  console.log(`web-contents-after=${JSON.stringify(after)}`);
  assert.ok(
    after.some(item => /^https?:/.test(item.url) && item.url !== startUrl),
    'headline click did not navigate to its href'
  );
} finally {
  await app.close();
}
