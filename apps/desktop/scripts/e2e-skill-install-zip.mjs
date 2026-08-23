/** Deterministic real Electron + real backend ZIP skill installation E2E. */
import { _electron as electron } from 'playwright';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const desktopRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const backendUrl = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8011';
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-skill-zip-'));
const fixture = path.join(userData, 'prompt-skills.zip');
const screenshot = path.resolve(
  repositoryRoot,
  'docs/screenshots/e2e-skill-install/03-zip-installed.png'
);

await run(
  path.join(repositoryRoot, '.venv/bin/python'),
  [
    '-c',
    [
      'import sys, zipfile',
      'p=sys.argv[1]',
      "z=zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED)",
      "z.writestr('repo/alpha-skill/SKILL.md','---\\nname: alpha-skill\\ndescription: Alpha E2E prompt skill\\n---\\nAlways answer alpha-ready.\\n')",
      "z.writestr('repo/beta-skill/SKILL.md','---\\nname: beta-skill\\ndescription: Beta E2E prompt skill\\n---\\nAlways answer beta-ready.\\n')",
      'z.close()'
    ].join(';'),
    fixture
  ]
);
await fs.mkdir(path.dirname(screenshot), { recursive: true });

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: desktopRoot,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    WORKBENCH_API_BASE_URL: backendUrl
  }
});

try {
  await app.evaluate(({ dialog }, selectedFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFile] });
  }, fixture);
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="shell"], [data-testid="account-onboarding"]', {
    timeout: 30_000
  });
  if (await page.$('[data-testid="account-onboarding"]')) {
    await page.getByTestId('account-advanced').click();
    await page.getByTestId('settings-base-url').fill(backendUrl);
    await page.getByTestId('settings-api-key').fill('test-key');
    await page.getByTestId('settings-tenant').fill('tenant-a');
    await page.getByTestId('settings-actor').fill('sup-001');
    await page.getByTestId('settings-save').click();
    await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  }

  await page.getByRole('button', { name: '选择文件' }).click();
  await page.locator('.assistant-composer .assistant-attachments').filter({
    hasText: 'prompt-skills.zip'
  }).waitFor({ timeout: 30_000 });

  const prepared = await page.evaluate(async () => {
    const conversations = await window.workbenchApi.request({
      method: 'GET',
      path: '/api/conversations?status=active&limit=1'
    });
    const conversationId = conversations.body.items?.[0]?.conversationId;
    if (!conversationId) throw new Error('conversation was not created');
    const artifacts = await window.workbenchApi.request({
      method: 'GET',
      path: `/api/conversations/${conversationId}/artifacts`
    });
    const artifactId = artifacts.body.artifacts?.[0]?.artifactId;
    if (!artifactId) throw new Error('zip artifact was not uploaded');
    const inspected = await window.workbenchApi.request({
      method: 'POST',
      path: '/api/skill-installations/from-artifact',
      body: { artifact_id: artifactId, conversation_id: conversationId }
    });
    const bundle = inspected.body.bundle;
    if (inspected.body.proposals?.length !== 0 || bundle?.candidates?.length !== 2) {
      throw new Error(`unexpected inspection: ${JSON.stringify(inspected.body)}`);
    }
    const selected = await window.workbenchApi.request({
      method: 'POST',
      path: `/api/skill-installations/uploads/${bundle.uploadId}/install`,
      body: { conversation_id: conversationId, selected_slugs: ['alpha-skill'] }
    });
    return {
      conversationId,
      uploadId: bundle.uploadId,
      candidateCount: bundle.candidates.length,
      installation: selected.body.installations?.[0]
    };
  });
  if (prepared.installation?.slug !== 'alpha-skill' || prepared.installation?.status !== 'installed') {
    throw new Error(`skill was not installed directly: ${JSON.stringify(prepared)}`);
  }

  await page.reload();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  if (await page.getByTestId('assistant-skill-install-proposal').count()) {
    throw new Error('ZIP install unexpectedly rendered a manual confirmation card');
  }
  const installations = await page.evaluate(async () => {
    const response = await window.workbenchApi.request({
      method: 'GET',
      path: '/api/skill-installations'
    });
    return response.body.installations;
  });
  if (!installations.some((item) => item.slug === 'alpha-skill' && item.status === 'enabled')) {
    throw new Error(`installed skill not visible: ${JSON.stringify(installations)}`);
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ ok: true, directInstall: true, ...prepared, screenshot }));
} finally {
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
