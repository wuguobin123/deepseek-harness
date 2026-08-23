/**
 * Regression: welcome prompt without an attachment, then upload an Excel file
 * and press Enter with an empty composer. The second turn must carry the file.
 */
import { _electron as electron } from 'playwright';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8012';
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-attachment-followup-'));
const fixture = path.join(userData, 'sales_data.xlsx');
const screenshot = path.resolve(
  import.meta.dirname,
  '../../../docs/screenshots/e2e-attachment-followup.png'
);

await run(
  path.resolve(import.meta.dirname, '../../../.venv/bin/python'),
  [
    '-c',
    [
      'from openpyxl import Workbook',
      'import sys',
      'book = Workbook()',
      'sheet = book.active',
      "sheet.title = '销售数据'",
      "sheet.append(['周次', '销售额', '订单数'])",
      "sheet.append(['2026-W31', 123456, 88])",
      'book.save(sys.argv[1])'
    ].join(';'),
    fixture
  ]
);
await fs.mkdir(path.dirname(screenshot), { recursive: true });

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
  await app.evaluate(({ dialog }, selectedFile) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedFile]
    });
  }, fixture);

  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.log(`[renderer:${message.type()}] ${message.text()}`);
    }
  });
  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.getByTestId('account-display-name').fill('附件回归用户');
  await page.getByTestId('account-email').fill(`attachment-${Date.now()}@example.com`);
  await page.getByTestId('account-password').fill('e2e-safe-password');
  await page.getByTestId('account-submit').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  await page.getByTestId('nav-home').click();
  await page.getByText('根据数据生成一份管理层周报', { exact: true }).click();

  const answers = page.getByTestId('assistant-answer');
  await answers.first().getByTestId('assistant-stream-status').waitFor({ timeout: 30_000 });
  await answers
    .first()
    .getByTestId('assistant-stream-status')
    .waitFor({ state: 'detached', timeout: 120_000 });

  await page.getByRole('button', { name: '选择文件' }).click();
  await page
    .locator('.assistant-composer .assistant-attachments')
    .filter({ hasText: 'sales_data.xlsx' })
    .waitFor({ timeout: 30_000 });
  await page.getByTestId('assistant-input').press('Enter');

  await answers.nth(1).getByTestId('assistant-stream-status').waitFor({ timeout: 30_000 });
  await answers
    .nth(1)
    .getByTestId('assistant-stream-status')
    .waitFor({ state: 'detached', timeout: 120_000 });
  const secondAnswer = (await answers.nth(1).textContent()) ?? '';
  const rejectedAsMissing = /没有(?:收到|上传).*附件|请上传需要分析的文件/.test(secondAnswer);
  if (rejectedAsMissing) {
    throw new Error(`second turn lost its attachment: ${secondAnswer}`);
  }

  const conversationId = await page.evaluate(async () => {
    const response = await window.workbenchApi.request({
      method: 'GET',
      path: '/api/conversations?status=active&limit=1'
    });
    return response.body.items?.[0]?.conversationId ?? null;
  });
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ ok: true, conversationId, secondAnswer, screenshot }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
