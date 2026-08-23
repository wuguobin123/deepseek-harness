/**
 * Focused re-check of flow e (conversation switch) without LLM generation:
 * launch app -> switch between two conversations with files -> assert the
 * file card / Files count / preview follow the ACTIVE conversation.
 * Run from apps/desktop: node scripts/e2e-flow-e-recheck.mjs
 */
import { _electron as electron } from 'playwright';

const SEEDED_TITLE = 'E2E-历史文件验证';
const SEEDED_FILE = 'e2e-weekly-report-template.md';
const SHOTS = '../../docs/screenshots/e2e-files-panel';

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
const page = await app.firstWindow();

const results = [];
const record = (flow, ok, note = '') => {
  results.push({ flow, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${note}`);
};

async function activeCardName() {
  const el = await page.$(
    '[data-testid="assistant-generated-files"] .generated-file-card__name'
  );
  return el ? el.textContent() : null;
}

async function filesMenuDescription() {
  await page.click('[data-testid="tools-launcher-trigger"]');
  await page.waitForSelector('[data-testid="tools-launcher-popover"]', { timeout: 5000 });
  const el = await page.$('[data-testid="tools-launcher-files"] small');
  const text = el ? await el.textContent() : null;
  await page.keyboard.press('Escape');
  return text;
}

try {
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    await page.click('[data-testid="settings-save"]');
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30000 });
  }
  // startup auto-selects the newest conversation (the one that generated report.md)
  await page.waitForSelector('[data-testid="assistant-generated-files"]', { timeout: 20000 });
  const initial = await activeCardName();
  console.log('initial conversation card:', initial);

  // switch to the seeded conversation
  await page.click(`.assistant-conversation-tabs button:has-text("${SEEDED_TITLE}")`);
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
  const switched = await activeCardName();
  const desc = await filesMenuDescription();
  record(
    'e-switch-conversation',
    switched?.includes(SEEDED_FILE) && desc?.includes('（1）'),
    `card: ${switched}; files desc: ${desc}`
  );
  await page.screenshot({ path: `${SHOTS}/e4-switched-conversation-card.png` });

  // click 预览 on the historical card -> blob preview loads
  await page.click(`[aria-label="预览 ${SEEDED_FILE}"]`);
  await page.waitForSelector('[data-testid="document-preview-panel"] iframe', { timeout: 30000 });
  const src = await page.getAttribute('[data-testid="document-preview-panel"] iframe', 'src');
  record('e-preview-after-switch', src?.startsWith('blob:'), `iframe src: ${src}`);
  await page.screenshot({ path: `${SHOTS}/e5-preview-after-switch.png` });

  // switch back to the report.md conversation: panel artifacts must follow
  await page.click('.assistant-conversation-tabs button:has-text("历史会话 1")');
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector(
        '[data-testid="assistant-generated-files"] .generated-file-card__name'
      );
      return el?.textContent?.includes(expected);
    },
    'report.md',
    { timeout: 15000 }
  );
  const back = await activeCardName();
  const descBack = await filesMenuDescription();
  record(
    'e-switch-back',
    back?.includes('report.md') && descBack?.includes('（1）'),
    `card: ${back}; files desc: ${descBack}`
  );
  await page.screenshot({ path: `${SHOTS}/e6-switched-back.png` });
} catch (error) {
  record('script-error', false, String(error).slice(0, 400));
  await page.screenshot({ path: `${SHOTS}/e-recheck-error.png` });
} finally {
  console.log('==== SUMMARY ====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.flow} ${r.note}`);
  await app.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
