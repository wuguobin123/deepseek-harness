import { _electron as electron } from 'playwright';
import path from 'node:path';

const app = await electron.launch({ args: ['.'], cwd: path.resolve(import.meta.dirname, '..') });
try {
  const page = await app.firstWindow();
  await page.getByTestId('shell').waitFor({ timeout: 20_000 });
  const htmlCard = page.getByTestId('assistant-generated-files').locator('article').filter({ hasText: '.html' }).first();
  await htmlCard.waitFor({ timeout: 20_000 });
  const filename = (await htmlCard.locator('strong').textContent())?.trim();
  await htmlCard.getByRole('button', { name: '预览' }).click();
  await page.getByTestId('document-preview-panel').waitFor({ timeout: 20_000 });
  const frame = page.getByTestId('document-preview-panel').locator('iframe');
  await frame.waitFor();
  const box = await page.getByTestId('document-preview-panel').boundingBox();
  if (!box || box.width < 300 || box.height < 300) throw new Error('preview panel has invalid size');
  console.log(JSON.stringify({ ok: true, filename, panel: box }));
} finally {
  await app.close();
}
