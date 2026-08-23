/**
 * E2E verification: DeepResearch mode renders the trace panel + toggles
 * between on and off.
 *
 * Drives the REAL built Electron client against the REAL backend. The
 * real DeepResearchEngine needs a working model gateway, so this script
 * uses the MOCK_WEB=1 server harness to skip real network fetch and
 * rely on the per-sub-question happy-path reflection (the regression
 * tests verify the algorithm end-to-end).
 *
 * Run from apps/desktop:
 *   node scripts/e2e-deep-research.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = '../../docs/screenshots/e2e-deep-research';
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

try {
  await page.waitForSelector('textarea[data-testid="assistant-input"]', { timeout: 15_000 });
  record('app-ready', true, '登录界面不再打扰');

  // 1. UI toggle must be present and toggles the deep mode flag
  const toggleExists = await page.evaluate(() => {
    return Boolean(document.querySelector('[data-testid="assistant-deep-toggle"]'));
  });
  record('toggle-visible', toggleExists, '深度研究按钮可见');

  await page.click('[data-testid="assistant-deep-toggle"]');
  await page.waitForTimeout(150);
  const isActive = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="assistant-deep-toggle"]');
    return el ? el.classList.contains('assistant-deep-toggle--active') : false;
  });
  record('toggle-active', isActive, '点击后 toggle 高亮');
  await shot('deep-toggle-on');

  // 2. Submit a deep-mode query (the backend may fall back to deterministic
  // synthesis when the model is unavailable, but the trace panel must still
  // appear — the renderer listens to the typed events).
  await page.fill(
    'textarea[data-testid="assistant-input"]',
    '请对比一下 PostgreSQL 16 和 17 的 logical replication 改进。'
  );
  await page.click('[data-testid="assistant-send"]');

  // 3. Wait for the trace panel (rendered when at least the plan event
  // arrives). The backend may take a moment if the slow path is exercised.
  await page.waitForSelector(
    '[data-testid="assistant-deep-trace"]',
    { timeout: 30_000 }
  ).catch(() => null);
  const traceVisible = await page.evaluate(() => {
    return Boolean(document.querySelector('[data-testid="assistant-deep-trace"]'));
  });
  record('trace-rendered', traceVisible, '深度研究 trace 面板出现在 assistant 流中');
  await shot('deep-trace');

  // 4. Toggle back to off
  await page.click('[data-testid="assistant-deep-toggle"]');
  await page.waitForTimeout(150);
  const isInactive = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="assistant-deep-toggle"]');
    return el ? !el.classList.contains('assistant-deep-toggle--active') : false;
  });
  record('toggle-inactive', isInactive, '再次点击关闭 toggle');
  await shot('deep-toggle-off');
} catch (err) {
  record('exception', false, err.message ?? String(err));
} finally {
  await app.close();
}

const failed = results.filter((item) => !item.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  process.exit(1);
}
