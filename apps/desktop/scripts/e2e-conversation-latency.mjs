/** Real Electron latency/effect acceptance for the conversation surface. */
import { _electron as electron } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8015';
const scenarios = JSON.parse(process.env.E2E_LATENCY_SCENARIOS ?? JSON.stringify([
  {
    name: 'plain',
    prompt: '请用一句话说明什么是 RAG。',
    expect: 'RAG|检索|生成'
  },
  {
    name: 'weather',
    prompt: '今天济南天气如何？',
    expect: '济南|天气|气温|度'
  },
  {
    name: 'url',
    prompt: '总结 https://example.com 这个页面的主要内容。',
    expect: 'Example|示例|页面|域名'
  }
]));
const userData = mkdtempSync(join(tmpdir(), 'workbench-latency-electron-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    WORKBENCH_API_BASE_URL: backendUrl,
    ELECTRON_ENABLE_LOGGING: '1'
  }
});

const page = await app.firstWindow();
const rendererErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') rendererErrors.push(message.text());
});

async function runScenario(scenario) {
  if (await page.getByTestId('assistant-page').count()) {
    await page.getByRole('button', { name: '新建', exact: true }).click();
  }
  const input = (await page.getByTestId('assistant-input').count())
    ? page.getByTestId('assistant-input')
    : page.getByTestId('home-assistant-input');
  await input.fill(scenario.prompt);
  const beforeCount = await page.getByTestId('assistant-answer').count();
  const startedAt = performance.now();
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="assistant-answer"]').length > count,
    beforeCount,
    { timeout: 120_000 }
  );
  const answer = page.getByTestId('assistant-answer').last();
  await answer.waitFor({ state: 'visible', timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
      const last = answers.item(answers.length - 1);
      return Boolean(last && (last.textContent ?? '').trim().length > 0);
    },
    undefined,
    { timeout: 120_000 }
  );
  const ttftMs = Math.round(performance.now() - startedAt);
  await page.waitForFunction(
    () => {
      const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
      const last = answers.item(answers.length - 1);
      return Boolean(last && !last.querySelector('[data-testid="assistant-stream-status"]'));
    },
    undefined,
    { timeout: 240_000 }
  );
  const totalMs = Math.round(performance.now() - startedAt);
  const text = (await answer.innerText()).trim();
  if (
    !text
    || !new RegExp(scenario.expect, 'i').test(text)
    || (scenario.reject && new RegExp(scenario.reject, 'i').test(text))
  ) {
    throw new Error(`${scenario.name} effect check failed: ${text.slice(0, 400)}`);
  }
  return {
    name: scenario.name,
    ttftMs,
    totalMs,
    answerChars: text.length,
    answerPreview: text.replace(/\s+/g, ' ').slice(0, 180)
  };
}

try {
  await page.waitForLoadState('domcontentloaded');
  const accountEmail = process.env.E2E_ACCOUNT_EMAIL;
  const accountPassword = process.env.E2E_ACCOUNT_PASSWORD;
  const accountMode = process.env.E2E_ACCOUNT_SIGNUP === 'true' ? 'signup' : 'login';
  if (accountEmail && !accountPassword) {
    throw new Error('E2E_ACCOUNT_PASSWORD is required when E2E_ACCOUNT_EMAIL is set');
  }
  const connected = accountEmail
    ? await page.evaluate(
      async ({ baseUrl, email, password, mode }) => window.workbenchApi.authenticateSession({
        mode,
        baseUrl,
        email,
        password,
        ...(mode === 'signup' ? { displayName: 'Latency E2E' } : {})
      }),
      { baseUrl: backendUrl, email: accountEmail, password: accountPassword, mode: accountMode }
    )
    : await page.evaluate(
      async ({ baseUrl }) => window.workbenchApi.updateSession({
        baseUrl,
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001'
      }),
      { baseUrl: backendUrl }
    );
  if (!connected.ok) throw new Error(`session setup failed: ${JSON.stringify(connected)}`);
  await page.reload();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  console.log(JSON.stringify({ backendUrl, results, rendererErrors }, null, 2));
  if (rendererErrors.length) throw new Error(`renderer errors: ${rendererErrors.join(' | ')}`);
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
