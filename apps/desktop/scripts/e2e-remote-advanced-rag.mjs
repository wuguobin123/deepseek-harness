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
const marker = `远端高级RAG验收-${stamp}`;
const baseName = `远端验收知识库-${stamp}`;
const documentTitle = `远端高级RAG制度-${stamp}`;
const answerNumber = '17';
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-remote-rag-'));
const screenshotDir = path.resolve(
  import.meta.dirname,
  '../../../docs/screenshots/e2e-remote-advanced-rag'
);
await fs.mkdir(screenshotDir, { recursive: true });

const rendererErrors = [];
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    WORKBENCH_API_BASE_URL: backendUrl
  }
});

try {
  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await page.waitForSelector('[data-testid="shell"], [data-testid="need-credentials"]', {
    timeout: 30_000
  });

  if (await page.getByTestId('need-credentials').isVisible().catch(() => false)) {
    await page.getByTestId('account-advanced').click();
    await page.getByTestId('settings-form').waitFor({ timeout: 10_000 });
    await page.getByTestId('settings-base-url').fill(backendUrl);
    await page.getByTestId('settings-api-key').fill(apiKey);
    await page.getByTestId('settings-tenant').fill(tenantId);
    await page.getByTestId('settings-actor').fill(actorId);
    await page.getByTestId('settings-save').click();
    await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  }

  const session = await page.evaluate(() => window.workbenchApi.getSession());
  if (
    session.baseUrl.replace(/\/$/, '') !== backendUrl.replace(/\/$/, '') ||
    session.tenantId !== tenantId ||
    session.actorId !== actorId ||
    !session.hasApiKey
  ) {
    throw new Error(`remote session was not persisted: ${JSON.stringify(session)}`);
  }

  await page.getByTestId('nav-knowledge').click();
  await page.getByTestId('knowledge-page').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '新建知识库' }).click();
  const createForm = page.getByTestId('knowledge-base-create');
  await createForm.getByLabel('知识库名称').fill(baseName);
  await createForm.getByLabel('领域标识').fill(`remote-e2e-${stamp}`);
  await createForm.getByLabel('路由关键词').fill(`${marker}，远端验收，年假`);
  await createForm.getByLabel('描述').fill('真实 Electron 连接腾讯云高级 RAG 的验收知识库');
  await createForm.getByRole('button', { name: '创建知识库' }).click();
  await createForm.waitFor({ state: 'detached', timeout: 30_000 });

  const baseSelect = page.getByTestId('knowledge-base-select');
  await baseSelect
    .locator('option', { hasText: baseName })
    .waitFor({ state: 'attached', timeout: 20_000 });
  const baseId = await baseSelect.inputValue();
  if (!baseId) throw new Error('created knowledge base was not selected');

  await page.getByRole('button', { name: '导入文档' }).click();
  const importForm = page.locator('form.knowledge-import').filter({
    has: page.getByText('导入知识文档', { exact: true })
  });
  await importForm.getByLabel('文档名称').fill(documentTitle);
  await importForm.getByLabel('文档内容').fill(
    `${marker}：正式成员每年享有 ${answerNumber} 天远端验收假期，申请需提前两个工作日。`
  );
  await importForm.getByRole('button', { name: '导入并建立索引' }).click();
  await importForm.waitFor({ state: 'detached', timeout: 90_000 });
  await page.getByTestId('knowledge-list').getByText(documentTitle).waitFor({ timeout: 30_000 });

  await page.getByTestId('knowledge-search').fill(`${marker}成员每年有多少天假期`);
  await page.getByTestId('knowledge-search-scope').selectOption(baseId);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText(documentTitle, { exact: true }).last().waitFor({ timeout: 90_000 });
  await page.getByText(new RegExp(`${answerNumber} 天`)).last().waitFor({ timeout: 30_000 });
  const routeText = await page.getByTestId('knowledge-route').textContent();
  await page.screenshot({
    path: path.join(screenshotDir, '01-remote-knowledge-search.png'),
    fullPage: true
  });

  await page.getByTestId('nav-home').click();
  const knowledgePicker = page.getByTestId('assistant-knowledge-base-select');
  await knowledgePicker
    .locator(`option[value="${baseId}"]`)
    .waitFor({ state: 'attached', timeout: 20_000 });
  await knowledgePicker.selectOption(baseId);
  await page.getByTestId('home-assistant-input').fill(
    `只依据绑定的企业知识库回答：${marker}正式成员每年有多少天远端验收假期？`
  );
  await page.getByTestId('assistant-send').click();
  const answer = page.getByTestId('assistant-answer').last();
  await answer.getByTestId('assistant-stream-status').waitFor({ timeout: 30_000 });
  await answer
    .getByTestId('assistant-stream-status')
    .waitFor({ state: 'detached', timeout: 120_000 });
  const answerText = await answer.textContent();
  if (!answerText?.includes(`${answerNumber} 天`) || !answerText.includes(String(stamp))) {
    throw new Error(`assistant answer is not grounded in the test document: ${answerText}`);
  }
  const answerSourcesText = await answer
    .locator('.assistant-sources')
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  await page.screenshot({
    path: path.join(screenshotDir, '02-remote-assistant-answer.png'),
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
  if (!restoredText?.includes(`${answerNumber} 天`) || !restoredText.includes(String(stamp))) {
    throw new Error(`restored answer is not the accepted test answer: ${restoredText}`);
  }
  const restoredSourcesText = await restoredAnswer
    .locator('.assistant-sources')
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  await page.screenshot({
    path: path.join(screenshotDir, '03-remote-history-restored.png'),
    fullPage: true
  });

  const relevantErrors = rendererErrors.filter(
    (value) => !value.includes('DevTools') && !value.includes('favicon')
  );
  if (relevantErrors.length > 0) {
    throw new Error(`renderer errors: ${JSON.stringify(relevantErrors)}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      backendUrl,
      tenantId,
      actorId,
      baseId,
      baseName,
      documentTitle,
      marker,
      conversationTitle,
      routeText,
      answerText,
      answerSourcesText,
      restoredText,
      restoredSourcesText,
      screenshotDir,
      userData
    })
  );
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
