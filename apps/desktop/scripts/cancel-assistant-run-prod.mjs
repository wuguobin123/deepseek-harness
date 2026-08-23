import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const [conversationId, runId] = process.argv.slice(2);
if (!conversationId || !runId) throw new Error('usage: cancel-assistant-run-prod <conversationId> <runId>');

const root = path.resolve(import.meta.dirname, '..');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cancel-run-e2e-'));
const credentialsFile = path.join(directory, 'credentials.json');
try {
  execFileSync(
    path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    [path.join(root, 'scripts/_decrypt-creds.cjs'), credentialsFile],
    { cwd: root, stdio: 'ignore' }
  );
  const credentials = JSON.parse(await fs.readFile(credentialsFile, 'utf8'));
  const response = await fetch(
    `${credentials.baseUrl.replace(/\/$/, '')}/api/conversations/${encodeURIComponent(conversationId)}/assistant/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': credentials.apiKey,
        'X-Tenant-ID': credentials.tenantId,
        'X-Actor-ID': credentials.actorId
      }
    }
  );
  if (!response.ok) throw new Error(`cancel -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  console.log('cancelled');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
