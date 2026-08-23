/**
 * E2E verification: assistant Files panel / Browser panel mutual exclusion,
 * per-conversation artifact loading, historical artifact_ref file cards.
 *
 * Drives the REAL built Electron client against the REAL backend (127.0.0.1:8000).
 * Run from apps/desktop:  node scripts/e2e-files-panel.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = '../../docs/screenshots/e2e-files-panel';
const SEEDED_TITLE = 'E2E-历史文件验证';
const SEEDED_FILE = 'e2e-weekly-report-template.md';

mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(flow, ok, note = '') {
  results.push({ flow, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${note}`);
}

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
const page = await app.firstWindow();
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300));
  }
});
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));

const shot = async (name) => {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  console.log(`screenshot: ${path}`);
};

async function panelState() {
  return page.evaluate(() => {
    const doc = document.querySelector('[data-testid="document-preview-panel"]');
    const browser = document.querySelector('[data-testid="browser-panel"]');
    const vis = (el) => {
      if (!el) return 'absent';
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
        ? 'visible'
        : 'hidden';
    };
    return { doc: vis(doc), browser: vis(browser) };
  });
}

async function openToolsMenu() {
  await page.click('[data-testid="tools-launcher-trigger"]');
  await page.waitForSelector('[data-testid="tools-launcher-popover"]', { timeout: 5000 });
}

async function filesMenuDescription() {
  const el = await page.$('[data-testid="tools-launcher-files"] small');
  return el ? (await el.textContent()) : null;
}

try {
  // ---- boot ----
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    // first run in this userData: accept the prefilled local dev defaults
    await page.click('[data-testid="settings-save"]');
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30000 });
  }
  // startup auto-selects the most recent conversation (the seeded one)
  await page.waitForSelector('[data-testid="assistant-generated-files"]', { timeout: 20000 });
  await shot('e1-startup-history-file-card');

  const cardName = await page.textContent(
    '[data-testid="assistant-generated-files"] .generated-file-card__name'
  );
  record('e-history-card', cardName?.includes(SEEDED_FILE), `card file name: ${cardName}`);

  await openToolsMenu();
  const descE = await filesMenuDescription();
  record('e-files-count', descE?.includes('（1）'), `files menu desc: ${descE}`);
  await shot('e2-tools-menu-seeded-conversation');
  await page.keyboard.press('Escape');

  // click 预览 on the historical card -> preview loads
  await page.click(`[aria-label="预览 ${SEEDED_FILE}"]`);
  await page.waitForSelector('[data-testid="document-preview-panel"] iframe', { timeout: 30000 });
  const iframeSrcE = await page.getAttribute(
    '[data-testid="document-preview-panel"] iframe', 'src'
  );
  record('e-historical-preview', iframeSrcE?.startsWith('blob:'), `iframe src: ${iframeSrcE}`);
  await shot('e3-historical-preview-loaded');

  // ---- flow f: empty state ----
  await page.click('.assistant-new-conversation');
  await page.waitForTimeout(500);
  await openToolsMenu();
  const descF = await filesMenuDescription();
  record('f-empty-count', descF?.includes('（0）'), `files menu desc: ${descF}`);
  await shot('f1-tools-menu-empty');
  await page.click('[data-testid="tools-launcher-files"]');
  await page.waitForSelector('[data-testid="document-preview-panel"]', { timeout: 5000 });
  const emptyText = await page.textContent('.document-preview__empty');
  const composerValue = await page.inputValue('[data-testid="home-assistant-input"], [data-testid="assistant-input"]').catch(() => '');
  record(
    'f-empty-state-panel',
    emptyText?.includes('暂无文件') && !composerValue,
    `empty text: ${emptyText?.trim().slice(0, 30)}; composer: "${composerValue}"`
  );
  await shot('f2-files-panel-empty-state');

  // ---- flow a/b: real generation ----
  const inputSel = (await page.$('[data-testid="assistant-input"]'))
    ? '[data-testid="assistant-input"]'
    : '[data-testid="home-assistant-input"]';
  await page.fill(inputSel, '帮我生成一份 Markdown 周报模板，保存为 md 文件');
  await page.click('[data-testid="assistant-send"]');
  // wait for the generated-file card (real LLM generation; generous timeout)
  await page.waitForSelector('[data-testid="assistant-generated-files"]', { timeout: 300000 });
  // preview panel should auto-open on the first generated file
  await page.waitForSelector('[data-testid="document-preview-panel"]', { timeout: 15000 });
  const stateAfterGen = await panelState();
  record('b-auto-open-preview', stateAfterGen.doc === 'visible', JSON.stringify(stateAfterGen));
  await page.waitForSelector('[data-testid="document-preview-panel"] iframe', { timeout: 60000 });
  const genName = await page.textContent(
    '[data-testid="assistant-generated-files"] .generated-file-card__name'
  );
  record('a-file-generated', Boolean(genName), `generated file: ${genName}`);
  await shot('a1-generation-auto-preview');

  await openToolsMenu();
  const descB = await filesMenuDescription();
  record('b-files-count-incremented', descB?.includes('（1）'), `files menu desc: ${descB}`);
  await shot('b1-tools-menu-after-generation');

  // ---- flow c: Files menu -> list view -> click file -> preview ----
  await page.click('[data-testid="tools-launcher-files"]');
  await page.waitForSelector('[data-testid="document-preview-panel"]', { timeout: 5000 });
  // list view: no active artifact -> empty content area + list visible
  await page.waitForSelector('.document-preview__empty', { timeout: 5000 });
  const listItem = await page.textContent('.document-item__name');
  record('c-list-view', listItem?.includes(genName ?? ''), `list item: ${listItem}`);
  await shot('c1-files-panel-list-view');

  await page.click('.document-item');
  await page.waitForSelector('[data-testid="document-preview-panel"] iframe', { timeout: 60000 });
  const iframeSrcC = await page.getAttribute(
    '[data-testid="document-preview-panel"] iframe', 'src'
  );
  record('c-list-click-preview', iframeSrcC?.startsWith('blob:'), `iframe src: ${iframeSrcC}`);
  await shot('c2-file-preview-from-list');

  // ---- flow d: Browser <-> Files mutual exclusion ----
  await openToolsMenu();
  await page.click('[data-testid="tools-launcher-browser"]');
  await page.waitForSelector('[data-testid="browser-panel"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const stateD1 = await panelState();
  record(
    'd-browser-excludes-doc',
    stateD1.browser === 'visible' && stateD1.doc === 'absent',
    JSON.stringify(stateD1)
  );
  await shot('d1-browser-panel-open');

  await openToolsMenu();
  await page.click('[data-testid="tools-launcher-files"]');
  await page.waitForSelector('[data-testid="document-preview-panel"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  const stateD2 = await panelState();
  record(
    'd-files-excludes-browser',
    stateD2.doc === 'visible' && stateD2.browser === 'absent',
    JSON.stringify(stateD2)
  );
  await shot('d2-files-panel-back');

  // ---- flow e (explicit): switch to seeded conversation ----
  await page.click(`.assistant-conversation-tabs button:has-text("${SEEDED_TITLE}")`);
  // wait until the switched conversation's messages + artifacts are actually rendered
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector(
        '[data-testid="assistant-generated-files"] .generated-file-card__name'
      );
      return el?.textContent?.includes(expected);
    },
    SEEDED_FILE,
    { timeout: 15000 }
  );
  const cardNameE = await page.textContent(
    '[data-testid="assistant-generated-files"] .generated-file-card__name'
  );
  await openToolsMenu();
  const descE2 = await filesMenuDescription();
  await page.keyboard.press('Escape');
  record(
    'e-switch-conversation',
    cardNameE?.includes(SEEDED_FILE) && descE2?.includes('（1）'),
    `card: ${cardNameE}; files desc: ${descE2}`
  );
  await shot('e4-switched-conversation-card');

  await page.click(`[aria-label="预览 ${SEEDED_FILE}"]`);
  await page.waitForSelector('[data-testid="document-preview-panel"] iframe', { timeout: 30000 });
  const iframeSrcE2 = await page.getAttribute(
    '[data-testid="document-preview-panel"] iframe', 'src'
  );
  record('e-preview-after-switch', iframeSrcE2?.startsWith('blob:'), `iframe src: ${iframeSrcE2}`);
  await shot('e5-preview-after-switch');
} catch (error) {
  record('script-error', false, String(error).slice(0, 500));
  await shot('error-state');
  // failure-layer diagnostics per AGENTS.md
  try {
    const diag = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, present: false };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          sel, present: true,
          rect: { w: r.width, h: r.height },
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity
        };
      };
      return [
        pick('[data-testid="document-preview-panel"]'),
        pick('[data-testid="browser-panel"]'),
        pick('[data-testid="assistant-generated-files"]'),
        pick('[data-testid="tools-launcher-popover"]')
      ];
    });
    console.log('diagnostics:', JSON.stringify(diag, null, 2));
  } catch { /* ignore */ }
} finally {
  console.log('\n==== SUMMARY ====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.flow} ${r.note}`);
  await app.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
