/**
 * Production E2E for goal-contract enforcement.  It uses the same headers
 * and persisted account as the desktop client, but does not start Playwright
 * or write credentials (macOS safeStorage has a separate injected-process
 * keychain context).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROMPT = '调研 AI Harness，把调研报告输出到飞书文档中。';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-contract-e2e-'));
const credentialsFile = path.join(directory, 'credentials.json');

function fail(message) {
  throw new Error(message);
}

try {
  execFileSync(ELECTRON, [path.join(ROOT, 'scripts/_decrypt-creds.cjs'), credentialsFile], {
    cwd: ROOT,
    stdio: 'ignore'
  });
  const credentials = JSON.parse(await fs.readFile(credentialsFile, 'utf8'));
  if (!credentials.apiKey || !credentials.baseUrl || !credentials.tenantId || !credentials.actorId) {
    fail('本机生产凭证不完整');
  }
  if (!String(credentials.baseUrl).includes('119.45.252.25')) {
    fail('本机凭证未指向生产服务');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': credentials.apiKey,
    'X-Tenant-ID': credentials.tenantId,
    'X-Actor-ID': credentials.actorId
  };
  const request = async (method, pathname, body) => {
    const response = await fetch(`${credentials.baseUrl.replace(/\/$/, '')}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) fail(`${method} ${pathname} -> ${response.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  };

  const conversation = await request('POST', '/api/conversations', {
    title: `E2E 目标契约·AI Harness·${new Date().toISOString()}`
  });
  const conversationId = conversation.conversationId ?? conversation.conversation_id;
  if (!conversationId) fail('创建会话未返回 conversationId');

  const stream = await fetch(
    `${credentials.baseUrl.replace(/\/$/, '')}/api/conversations/${encodeURIComponent(conversationId)}/assistant/stream`,
    {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `goal-contract-e2e-${Date.now()}` },
      body: JSON.stringify({
        client_message_id: `goal-contract-e2e-${Date.now()}`,
        message: PROMPT,
        deep_mode: false
      })
    }
  );
  if (!stream.ok) fail(`assistant stream -> ${stream.status}: ${(await stream.text()).slice(0, 500)}`);
  const streamText = await stream.text();
  const events = [];
  for (const block of streamText.split('\n\n')) {
    const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    try {
      events.push({
        event: eventLine?.slice(6).trim() ?? '',
        data: JSON.parse(dataLine.slice(5).trim())
      });
    } catch {
      // Ignore non-JSON keepalive frames.
    }
  }

  const messages = await request(
    'GET',
    `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`
  );
  const assistant = [...(messages.messages ?? [])].reverse().find((item) => item.role === 'assistant');
  const metadata = assistant?.metadata ?? {};
  const text = assistant?.content?.blocks
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n') ?? '';
  const terminal = events.at(-1)?.data?.type ?? events.at(-1)?.event ?? 'none';
  const larkUrl = text.match(/https:\/\/(?:[\w-]+\.)?(?:feishu\.cn|larksuite\.com)\/docx\/[^\s)]+/i)?.[0] ?? null;
  const summary = {
    conversationId,
    terminal,
    eventTypes: events.map((item) => item.data?.type ?? item.event),
    persistedRunStatus: metadata.runStatus ?? metadata.run_status ?? null,
    goalContractState: metadata.goalContractState ?? metadata.goal_contract_state ?? null,
    evidenceStatus: metadata.evidenceStatus ?? metadata.evidence_status ?? null,
    invokedCapabilities: metadata.invokedCapabilityIds ?? metadata.invoked_capability_ids ?? [],
    documentUrl: larkUrl,
    answerPreview: text.replace(/\s+/g, ' ').slice(0, 400)
  };
  console.log(JSON.stringify(summary, null, 2));

  if (summary.persistedRunStatus === 'completed') {
    if (!summary.documentUrl) fail('完成态缺少飞书文档链接');
    if (!summary.invokedCapabilities.includes('workbench.cli_invoke')) {
      fail('完成态未调用飞书 CLI 能力');
    }
  } else if (summary.persistedRunStatus === 'failed') {
    if (terminal !== 'error') fail('目标契约失败未通过 SSE error 返回给客户端');
    if (summary.goalContractState !== 'partial') fail('失败态未保留目标契约状态');
  } else {
    fail(`出现非终态: ${summary.persistedRunStatus}`);
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
