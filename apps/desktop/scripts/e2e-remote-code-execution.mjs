import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL;
const apiKey = process.env.WORKBENCH_E2E_API_KEY;
const tenantId = process.env.WORKBENCH_E2E_TENANT_ID ?? 'tenant-a';
const actorId = process.env.WORKBENCH_E2E_ACTOR_ID ?? 'sup-001';
if (!backendUrl || !apiKey) {
  throw new Error('WORKBENCH_E2E_BACKEND_URL and WORKBENCH_E2E_API_KEY are required');
}

const stamp = Date.now();
const marker = `sandbox-ok-${stamp}`;
const filename = `sandbox-acceptance-${stamp}.txt`;
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-remote-sandbox-'));
const screenshotDir = path.resolve(
  import.meta.dirname,
  '../../../docs/screenshots/e2e-remote-sandbox'
);
await fs.mkdir(screenshotDir, { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });
  if (await page.getByTestId('need-credentials').isVisible().catch(() => false)) {
    await page.getByTestId('account-advanced').click();
    await page.getByTestId('settings-base-url').fill(backendUrl);
    await page.getByTestId('settings-api-key').fill(apiKey);
    await page.getByTestId('settings-tenant').fill(tenantId);
    await page.getByTestId('settings-actor').fill(actorId);
    await page.getByTestId('settings-save').click();
    await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  }

  const prompt = [
    `远端沙箱验收 ${stamp}。`,
    '必须调用 workbench.code_execute 执行 Python，不要心算。',
    `计算 6 * 7，并在 outputs/${filename} 写入精确文本 ${marker}。`,
    '最终回答给出真实 stdout、退出码和生成文件。'
  ].join(' ');
  await page.getByTestId('home-assistant-input').fill(prompt);
  await page.getByTestId('assistant-send').click();
  await page.getByTestId('assistant-stop').waitFor({ timeout: 30_000 });
  await page.getByTestId('assistant-stop').waitFor({ state: 'hidden', timeout: 180_000 });

  const answer = page.getByTestId('assistant-answer').last();
  await answer.waitFor({ timeout: 30_000 });
  const answerText = await answer.textContent();
  if (!answerText?.includes('42') || !answerText.includes(filename)) {
    throw new Error(`sandbox answer is incomplete: ${answerText}`);
  }
  const generatedFiles = answer.getByTestId('assistant-generated-files');
  await generatedFiles.getByText(filename, { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: path.join(screenshotDir, '01-sandbox-executed.png'),
    fullPage: true
  });

  const conversationTitle = await page
    .locator('.assistant-conversation-tabs button.is-active strong')
    .textContent();
  if (!conversationTitle) throw new Error('active conversation title is missing');
  await page.locator('.assistant-new-conversation').click();
  await page.locator('.assistant-welcome').waitFor({ timeout: 10_000 });
  await page
    .locator('.assistant-conversation-tabs button')
    .filter({ hasText: conversationTitle })
    .first()
    .click();
  const restoredAnswer = page.getByTestId('assistant-answer').last();
  await restoredAnswer.waitFor({ timeout: 30_000 });
  const restoredText = await restoredAnswer.textContent();
  if (!restoredText?.includes('42') || !restoredText.includes(filename)) {
    throw new Error(`restored sandbox answer is incomplete: ${restoredText}`);
  }
  await restoredAnswer
    .getByTestId('assistant-generated-files')
    .getByText(filename, { exact: true })
    .waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: path.join(screenshotDir, '02-sandbox-history-restored.png'),
    fullPage: true
  });

  console.log(
    JSON.stringify({
      ok: true,
      backendUrl,
      tenantId,
      actorId,
      marker,
      filename,
      conversationTitle,
      answerText,
      restoredText,
      screenshotDir
    })
  );
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
