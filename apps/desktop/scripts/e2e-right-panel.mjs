/**
 * Focused E2E for the ChatGPT-style right workspace switcher.
 * Drives the built Electron client against the local backend.
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const shotsDir = '../../docs/screenshots/e2e-right-panel';
mkdirSync(shotsDir, { recursive: true });

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
const page = await app.firstWindow();

page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log(`[renderer:error] ${message.text().slice(0, 400)}`);
  }
});

function visiblePanelState() {
  return page.evaluate(() => {
    const inspect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return { present: false };
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        present: true,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0',
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity
      };
    };
    return {
      files: inspect('[data-testid="document-preview-panel"]'),
      browser: inspect('[data-testid="browser-panel"]'),
      switcher: inspect('[data-testid="right-panel-switcher"]')
    };
  });
}

async function screenshot(name) {
  const path = `${shotsDir}/${name}.png`;
  await page.screenshot({ path });
  console.log(`screenshot=${path}`);
}

try {
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    const advanced = await page.$('[data-testid="account-advanced"]');
    if (advanced) await advanced.click();
    const defaults = await page.$('[data-testid="settings-use-defaults"]');
    if (defaults) await defaults.click();
    await page.click('[data-testid="settings-save"]');
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30_000 });
  }

  assert.equal(
    await page.locator('[data-testid="assistant-browser-toggle"]').count(),
    0
  );
  const composerText = await page.locator('.assistant-composer').innerText();
  assert.equal(composerText.includes('智能执行模式'), false);
  assert.equal(composerText.includes('自动路由'), true);
  await screenshot('00-composer-actions');

  await page.click('[data-testid="tools-launcher-trigger"]');
  await page.waitForSelector('[data-testid="tools-launcher-popover"]');
  await page.waitForTimeout(250);
  assert.equal(
    await page.getAttribute('[data-testid="tools-launcher-trigger"]', 'aria-label'),
    '打开右侧面板'
  );
  const menuEntries = await page
    .locator('[data-testid="tools-launcher-popover"] [data-testid^="tools-launcher-"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid'))
    );
  assert.deepEqual(menuEntries, [
    'tools-launcher-files',
    'tools-launcher-browser'
  ]);
  await screenshot('01-tools-menu');

  await page.click('[data-testid="tools-launcher-files"]');
  await page.waitForSelector('[data-testid="document-preview-panel"]');
  await page.waitForTimeout(250);
  const filesState = await visiblePanelState();
  assert.equal(filesState.files.visible, true);
  assert.equal(filesState.browser.present, false);
  assert.equal(filesState.switcher.visible, true);
  assert.equal(
    await page.getAttribute('[data-testid="right-panel-files-tab"]', 'aria-selected'),
    'true'
  );
  console.log(`files-state=${JSON.stringify(filesState)}`);
  await screenshot('02-files-panel');

  const browserTab = await page.$('[data-testid="right-panel-browser-tab"]');
  if (browserTab) {
    await browserTab.click();
  } else {
    await page.click('[data-testid="tools-launcher-trigger"]');
    await page.click('[data-testid="tools-launcher-browser"]');
  }
  await page.waitForSelector('[data-testid="browser-panel"]', { timeout: 15_000 });
  await page.waitForTimeout(500);
  const browserState = await visiblePanelState();
  assert.equal(browserState.browser.visible, true);
  assert.equal(browserState.files.present, false);
  assert.equal(browserState.switcher.visible, true);
  assert.equal(
    await page.getAttribute('[data-testid="right-panel-browser-tab"]', 'aria-selected'),
    'true'
  );
  console.log(`browser-state=${JSON.stringify(browserState)}`);
  await screenshot('03-browser-panel');

  const filesTab = await page.$('[data-testid="right-panel-files-tab"]');
  if (filesTab) {
    await filesTab.click();
    await page.waitForSelector('[data-testid="document-preview-panel"]');
    await page.waitForTimeout(300);
    const returnState = await visiblePanelState();
    assert.equal(returnState.files.visible, true);
    assert.equal(returnState.browser.present, false);
    console.log(`return-state=${JSON.stringify(returnState)}`);
    await screenshot('04-files-panel-return');

    await page.click('[data-testid="document-preview-close"]');
    await page.waitForSelector('[data-testid="document-preview-panel"]', {
      state: 'detached'
    });
    const closedState = await visiblePanelState();
    assert.equal(closedState.files.present, false);
    assert.equal(closedState.browser.present, false);
    console.log(`closed-state=${JSON.stringify(closedState)}`);
    await screenshot('05-panel-closed');
  }
} finally {
  await app.close();
}
