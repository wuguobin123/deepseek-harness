import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const bin = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const port = 9223;
const proc = spawn(bin, ['--remote-debugging-port=' + port, '.'], {
  cwd: root,
  env: { ...process.env },
  stdio: 'ignore'
});
try {
  // 等待 CDP 端口就绪
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      ok = res.ok;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!ok) throw new Error('CDP port not ready');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0] ?? await contexts[0].newPage();
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', { timeout: 30_000 });
  const state = await page.evaluate(() => ({
    shell: !!document.querySelector('[data-testid="shell"]'),
    needCredentials: !!document.querySelector('[data-testid="need-credentials"]')
  }));
  console.log('PAGE_STATE', JSON.stringify(state));
  if (state.shell) {
    const session = await page.evaluate(() => window.workbenchApi.getSession());
    console.log('SESSION', JSON.stringify(session));
  }
  await browser.close();
} finally {
  proc.kill('SIGTERM');
}
