import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL || 'http://127.0.0.1:8011';
const crmPort = Number(process.env.WORKBENCH_E2E_CRM_PORT || 19091);
const crmBaseUrl = `http://127.0.0.1:${crmPort}/api`;
const screenshots = path.resolve(
  import.meta.dirname,
  '../../../docs/screenshots/e2e-business-connector'
);
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-connector-e2e-'));
await fs.mkdir(screenshots, { recursive: true });

const observed = { health: 0, customer: 0 };
const crm = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.headers['x-demo-key'] !== 'demo-secret') {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  if (request.url === '/api/' || request.url === '/api/health') {
    observed.health += 1;
    response.end(JSON.stringify({ ok: true, system: 'Electron E2E CRM' }));
    return;
  }
  if (request.url === '/api/customers/C-1001') {
    observed.customer += 1;
    response.end(
      JSON.stringify({
        customer_id: 'C-1001',
        name: '星河科技',
        tier: '重点客户',
        owner: '王敏',
        open_tickets: 2
      })
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found', path: request.url }));
});
await new Promise((resolve, reject) => {
  crm.once('error', reject);
  crm.listen(crmPort, '127.0.0.1', resolve);
});

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
  await page.waitForLoadState('domcontentloaded');
  const connected = await page.evaluate(
    async ({ baseUrl }) =>
      window.workbenchApi.updateSession({
        baseUrl,
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001'
      }),
    { baseUrl: backendUrl }
  );
  assert.equal(connected.ok, true, JSON.stringify(connected));
  await page.reload();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });

  await page.getByTestId('nav-integrations').click();
  await page.getByTestId('connector-add').click();
  const form = page.getByTestId('connector-form');
  await form.getByLabel('连接名称').fill('Electron E2E CRM');
  await form.getByLabel('服务地址').fill(crmBaseUrl);
  await form.getByLabel('认证方式').selectOption('api_key');
  await form.getByLabel('API Key', { exact: true }).fill('demo-secret');
  await form.getByLabel('Header 名称').fill('X-Demo-Key');
  await form.getByLabel('允许访问本机或内网地址（仅用于可信业务系统）').check();
  await form.getByRole('button', { name: '保存连接' }).click();

  const card = page.locator('[data-testid^="connector-"]').filter({
    hasText: 'Electron E2E CRM'
  });
  await card.waitFor({ timeout: 20_000 });
  await card.getByRole('button', { name: '测试连接' }).click();
  await card.getByText('connected', { exact: true }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshots, '01-connected.png'), fullPage: true });

  await page.getByTestId('nav-home').click();
  const prompt =
    '请从 Electron E2E CRM 业务系统查询客户 C-1001。接口路径是 /customers/C-1001，' +
    '告诉我客户名称、等级、负责人和未结工单数。';
  await page.getByTestId('home-assistant-input').fill(prompt);
  await page.getByTestId('assistant-send').click();
  await page.waitForFunction(
    () => {
      const answers = document.querySelectorAll('[data-testid="assistant-answer"]');
      const last = answers.item(answers.length - 1);
      return Boolean(last && !last.querySelector('[data-testid="assistant-stream-status"]'));
    },
    undefined,
    { timeout: 240_000 }
  );
  const answer = await page.getByTestId('assistant-answer').last().innerText();
  assert.match(answer, /星河科技/);
  assert.match(answer, /重点客户/);
  assert.match(answer, /王敏/);
  assert.match(answer, /2/);
  await page.screenshot({ path: path.join(screenshots, '02-agent-result.png'), fullPage: true });

  assert.ok(observed.health >= 1, 'the desktop connection test did not reach the CRM');
  assert.ok(observed.customer >= 1, 'the conversation agent did not query the CRM');
  console.log(JSON.stringify({ ok: true, observed, answer, screenshots }));
} finally {
  await app.close();
  await new Promise((resolve) => crm.close(resolve));
  await fs.rm(userData, { recursive: true, force: true });
}
