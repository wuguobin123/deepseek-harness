/** Real Electron acceptance for automatic structured stock-quote routing. */
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8000';
const email = process.env.E2E_ACCOUNT_EMAIL ?? `finance-e2e-${Date.now()}@example.com`;
const password = process.env.E2E_ACCOUNT_PASSWORD ?? 'e2e-safe-password';
const login = Boolean(process.env.E2E_ACCOUNT_EMAIL);
const prompt = process.env.E2E_FINANCE_PROMPT ?? '查询一下美团当前的股票价格';
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-finance-electron-'));

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    WORKBENCH_API_BASE_URL: backendUrl,
    ELECTRON_ENABLE_LOGGING: '1'
  }
});

try {
  const page = await app.firstWindow();
  const rendererErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  if (login) {
    await page.locator('[role="tablist"] button').filter({ hasText: /^登录$/ }).click();
  } else {
    await page.getByTestId('account-display-name').fill('股票验收用户');
    const verification = page.getByTestId('account-verification-code');
    if (await verification.count()) await verification.fill('000000');
  }
  await page.getByTestId('account-email').fill(email);
  await page.getByTestId('account-password').fill(password);
  await page.getByTestId('account-submit').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  const input = (await page.getByTestId('assistant-input').count())
    ? page.getByTestId('assistant-input')
    : page.getByTestId('home-assistant-input');
  await input.fill(prompt);
  const beforeCount = await page.getByTestId('assistant-answer').count();
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="assistant-answer"]').length > count,
    beforeCount,
    { timeout: 180_000 }
  );
  const answer = page.getByTestId('assistant-answer').last();
  await answer.getByTestId('assistant-stream-status').waitFor({ timeout: 60_000 }).catch(() => {});
  await answer
    .getByTestId('assistant-stream-status')
    .waitFor({ state: 'detached', timeout: 240_000 })
    .catch(() => {});
  const answerText = ((await answer.innerText()) ?? '').trim();

  const traceText = ((await answer.getByTestId('assistant-deep-trace').innerText().catch(() => '')) ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const persisted = await page.evaluate(async () => {
    const conversations = await window.workbenchApi.request({
      method: 'GET',
      path: '/api/conversations?status=active&limit=1'
    });
    const conversationId = conversations.body.items?.[0]?.conversationId;
    if (!conversationId) return null;
    return { conversationId };
  });
  const summary = {
    ok:
      /美团|03690/.test(answerText) &&
      /港元|HKD/.test(answerText) &&
      /腾讯/.test(answerText) &&
      /当前股价|当前价|现价|最新价/.test(answerText),
    backendUrl,
    conversationId: persisted?.conversationId ?? null,
    answerPreview: answerText.replace(/\s+/g, ' ').slice(0, 500),
    tracePreview: (traceText || answerText).slice(0, 300),
    rendererErrors: rendererErrors.slice(0, 5),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) throw new Error(`quote not visible: ${summary.answerPreview}`);
  if (!/执行轨迹\s+\d+\s*个步骤/.test(traceText || answerText)) {
    throw new Error(`execution trace not visible: ${traceText || answerText}`);
  }
  if (rendererErrors.length) throw new Error(`renderer errors: ${JSON.stringify(rendererErrors)}`);
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
