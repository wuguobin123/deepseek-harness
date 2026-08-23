// E2E 验收：桌面客户端问答安装 GitHub CLI（生产后端，真实模型）。
// 流程：注入凭证 → 新建会话提问「安装 GitHub CLI 并 gh --version 验证」
//       → 等待运行结束 → 断言最终答复包含真实版本输出。
// 凭证纪律（AGENTS.md safeStorage 坑）：必须用独立 --user-data-dir +
// E2E_CREDS_FILE 明文注入——playwright 启动形态读不到真实 Keychain 项，
// 若让它写默认 profile 的 credentials.bin 会用回退密钥覆写、用户掉登录。
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const EXPECTED_ACCOUNT = process.env.E2E_ACCOUNT ?? 'personal-17b087408b9a43fc';
const PROD_MARK = process.env.E2E_PROD_MARK ?? '119.45.252.25';
const PROMPT =
  '安装 GitHub CLI，然后执行 gh --version 验证安装结果，并把版本输出原样贴出来。';
const SHOTS = path.resolve(import.meta.dirname, '../../../docs/screenshots/e2e-gh-install-prod');
await fs.mkdir(SHOTS, { recursive: true });

const ROOT = path.resolve(import.meta.dirname, '..');
const CREDS_FILE = process.env.E2E_CREDS_FILE
  ? path.resolve(process.env.E2E_CREDS_FILE)
  : path.join(os.tmpdir(), `e2e-creds-${process.pid}.json`);
if (!process.env.E2E_CREDS_FILE) {
  execFileSync(
    path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    [path.join(ROOT, 'scripts/_decrypt-creds.cjs'), CREDS_FILE],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
}
const storedCreds = JSON.parse(await fs.readFile(CREDS_FILE, 'utf8'));
if (storedCreds.tenantId !== EXPECTED_ACCOUNT && storedCreds.actorId !== EXPECTED_ACCOUNT) {
  console.log(`FATAL: 本机凭证账户不符 ${storedCreds.tenantId}/${storedCreds.actorId}`);
  process.exit(1);
}
if (!String(storedCreds.baseUrl).includes(PROD_MARK)) {
  console.log(`FATAL: 本机凭证指向非生产后端 ${storedCreds.baseUrl}`);
  process.exit(1);
}
console.log('[step] credentials-ok', JSON.stringify({ actorId: storedCreds.actorId }));

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-gh-install-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  page.on('pageerror', (err) => console.log('[pageerror]', String(err?.stack || err)));
  await page.setViewportSize({ width: 1440, height: 960 });

  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });
  if (await page.$('[data-testid="need-credentials"]')) {
    const injected = await page.evaluate(
      (creds) =>
        window.workbenchApi.updateSession({
          apiKey: creds.apiKey,
          tenantId: creds.tenantId,
          actorId: creds.actorId,
          baseUrl: creds.baseUrl
        }),
      storedCreds
    );
    if (!injected?.ok) {
      console.log('FATAL: 凭证注入失败', JSON.stringify(injected));
      process.exit(1);
    }
    await page.reload();
    await page.waitForSelector('[data-testid="shell"]', { timeout: 30_000 });
  }
  console.log('[step] shell-ready');

  // 显式新建会话：避免落入含历史失败叙事（"限流/exhausted"）的旧会话，
  // 模型会被历史带偏而不调用工具（2026-08-12 实测）。
  const newButton = page.locator('button.assistant-new-conversation');
  if (await newButton.count()) {
    await newButton.first().click();
  } else {
    await page.locator('[data-testid="nav-home"]').first().click();
  }
  await page.waitForTimeout(800);
  const input = page.locator('[data-testid="assistant-input"], [data-testid="home-assistant-input"]');
  await input.first().waitFor({ timeout: 30_000 });
  await input.first().fill(PROMPT);
  await page.getByTestId('assistant-send').click();
  console.log('[step] prompt-sent');

  await page
    .getByTestId('assistant-stop')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => console.log('[warn] stop button never appeared (run may have finished fast)'));
  await page
    .getByTestId('assistant-stop')
    .waitFor({ state: 'detached', timeout: 600_000 });
  await page.screenshot({ path: path.join(SHOTS, '01-answer.png') });

  const answer = await page.evaluate(() => {
    const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
    return answers.item(answers.length - 1)?.textContent ?? '';
  });
  console.log('[step] answer-tail', JSON.stringify(answer.slice(-300)));
  if (!/gh version 2\.\d+/i.test(answer)) {
    console.log('FAIL: 最终答复未包含 gh 版本输出');
    process.exitCode = 1;
  } else {
    console.log('PASS: 客户端问答完成 GitHub CLI 安装并通过 gh --version 验证');
  }
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
  if (!process.env.E2E_CREDS_FILE) await fs.rm(CREDS_FILE, { force: true });
}
