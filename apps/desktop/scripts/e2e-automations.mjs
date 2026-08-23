/**
 * E2E verification: automation triggers (cron) — OpenClaw-style cron test.
 *
 * Dual-path, same pattern as OpenClaw's cron tests:
 *   fast path: POST /api/triggers/{id}/test (force-run) → firing recorded →
 *              automation conversation created with the marker prompt →
 *              assistant reply (async LLM, WARN-only if slow);
 *   slow path: enable the per-minute cron → scheduler fires it naturally →
 *              exactly one new firing, then a quiet window with no duplicate.
 * Then the real Electron client: login → automations page → triggers page →
 * home conversation list, asserting the marker shows up in each surface.
 *
 * Unique marker (E2E自动化-<ts>) prevents cross-talk with other runs.
 *
 * Run from apps/desktop:  node scripts/e2e-automations.mjs
 * Requires the real backend on WORKBENCH_E2E_BACKEND_URL (default 127.0.0.1:8000).
 */
import { _electron as electron } from 'playwright';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BACKEND = process.env.WORKBENCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8000';
const SHOTS = '../../docs/screenshots/e2e-automations';
const MARKER = `E2E自动化-${Date.now()}`;
const MARKER_PROMPT = `${MARKER} 这是一次自动化端到端测试，请只回复两个字：收到`;
const MARKER_TITLE = `${MARKER}-任务`;
const EMAIL = `e2e-automation-${Date.now()}@example.com`;
const PASSWORD = 'e2e-safe-password';

mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(flow, ok, note = '') {
  results.push({ flow, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${note}`);
}
function warn(flow, note) {
  results.push({ flow, ok: true, note: `WARN ${note}` });
  console.log(`WARN [${flow}] ${note}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(token, method, pathName, body) {
  const response = await fetch(`${BACKEND}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-API-Key': token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON body */
  }
  return { status: response.status, data };
}

async function poll(fn, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll timeout (${label}) after ${timeoutMs}ms`);
}

let token = null;
let triggerId = null;
let app = null;
let userData = null;
const timings = {};

try {
  // ---- 1. signup + create trigger (Node-side API) ----
  const signup = await api(null, 'POST', '/api/auth/signup', {
    email: EMAIL,
    password: PASSWORD,
    display_name: 'E2E自动化'
  });
  token = signup.data?.access_token ?? null;
  record('api.signup', signup.status === 201 && Boolean(token), `status=${signup.status} email=${EMAIL}`);

  const created = await api(token, 'POST', '/api/triggers', {
    pluginId: 'builtin',
    capabilityId: 'workbench.agent_prompt',
    type: 'cron',
    config: { cron: '* * * * *', timezone: 'UTC' },
    arguments: { prompt: MARKER_PROMPT, title: MARKER_TITLE },
    condition: null
  });
  triggerId = created.data?.trigger_id ?? null;
  record(
    'api.create_trigger',
    created.status === 201 && Boolean(triggerId),
    `status=${created.status} trigger=${triggerId} version=${created.data?.version} state=${created.data?.status}`
  );

  const getTrigger = async () => {
    const list = await api(token, 'GET', '/api/triggers');
    return (list.data?.triggers ?? []).find((item) => item.trigger_id === triggerId) ?? null;
  };
  const firingsFor = async () => {
    const recent = await api(token, 'GET', '/api/triggers/firings/recent?limit=20');
    return (recent.data?.firings ?? []).filter((firing) => firing.trigger_id === triggerId);
  };

  // ---- 2. force-run fast path ----
  const forced = await api(token, 'POST', `/api/triggers/${triggerId}/test`, { expected_version: 1 });
  record(
    'api.force_run',
    forced.status === 200 && forced.data?.trigger_id === triggerId,
    `status=${forced.status} firing=${forced.data?.firing_id} state=${forced.data?.status}`
  );

  const forceStarted = Date.now();
  const forceFiring = await poll(
    async () => {
      const firings = await firingsFor();
      return firings.find((firing) => firing.status === 'succeeded') ?? null;
    },
    { timeoutMs: 30_000, label: 'force-run firing succeeded' }
  );
  record(
    'api.force_run.firing_recorded',
    true,
    `firing=${forceFiring.firing_id} status=${forceFiring.status} command=${forceFiring.command_id} waited=${Date.now() - forceStarted}ms`
  );

  const markerConversation = await poll(
    async () => {
      const list = await api(token, 'GET', '/api/conversations?scope_type=automation&limit=10');
      for (const item of list.data?.items ?? []) {
        if (!String(item.title ?? '').includes(MARKER)) continue;
        const messages = await api(token, 'GET', `/api/conversations/${item.conversation_id}/messages`);
        if (JSON.stringify(messages.data).includes(MARKER)) return item;
      }
      return null;
    },
    { timeoutMs: 30_000, label: 'automation conversation with marker prompt' }
  );
  record(
    'api.force_run.conversation',
    true,
    `conversation=${markerConversation.conversation_id} title=${markerConversation.title}`
  );

  // Assistant reply is async (LLM); wait up to 120s but only WARN if slow.
  const replyStarted = Date.now();
  try {
    const reply = await poll(
      async () => {
        const messages = await api(
          token,
          'GET',
          `/api/conversations/${markerConversation.conversation_id}/messages?limit=50`
        );
        for (const envelope of messages.data?.messages ?? []) {
          const message = envelope.message ?? envelope;
          if (message.role !== 'assistant') continue;
          const raw =
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
          if (raw.length > 20) return raw;
        }
        return null;
      },
      { timeoutMs: 120_000, intervalMs: 3000, label: 'assistant reply' }
    );
    timings.llmReplyMs = Date.now() - replyStarted;
    record('api.force_run.assistant_reply', true, `waited=${timings.llmReplyMs}ms reply=${reply.slice(0, 80)}`);
  } catch {
    timings.llmReplyMs = null;
    warn('api.force_run.assistant_reply', 'no assistant reply within 120s (model service may be slow)');
  }

  // ---- 3. natural cron slow path ----
  const baselineCount = (await firingsFor()).length;
  const current = await getTrigger();
  const enabled = await api(token, 'POST', `/api/triggers/${triggerId}/enable`, {
    expected_version: current.version
  });
  record(
    'api.natural.enable',
    enabled.status === 200 && Boolean(enabled.data?.next_fire_at),
    `status=${enabled.status} version=${enabled.data?.version} next_fire_at=${enabled.data?.next_fire_at}`
  );

  const naturalStarted = Date.now();
  const naturalFiring = await poll(
    async () => {
      const firings = await firingsFor();
      return firings.length === baselineCount + 1 ? firings[0] : null;
    },
    { timeoutMs: 100_000, intervalMs: 2000, label: 'natural cron firing' }
  );
  timings.naturalWaitMs = Date.now() - naturalStarted;
  record(
    'api.natural.fired_once',
    true,
    `firing=${naturalFiring.firing_id} status=${naturalFiring.status} waited=${(timings.naturalWaitMs / 1000).toFixed(1)}s (baseline=${baselineCount})`
  );

  // Duplicate window: shortened from 70s to 15s — a per-minute cron would
  // legitimately fire again at the next minute boundary, so a long window
  // would false-positive on the next *scheduled* tick rather than a duplicate.
  await sleep(15_000);
  const afterQuiet = await firingsFor();
  record(
    'api.natural.no_duplicate',
    afterQuiet.length === baselineCount + 1,
    `firings after 15s quiet window=${afterQuiet.length} (expected ${baselineCount + 1})`
  );

  // ---- 4. client UI path (trigger left enabled so the automations page shows 下次运行) ----
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-e2e-automations-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      WORKBENCH_API_BASE_URL: BACKEND
    }
  });
  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[renderer:${msg.type()}]`, msg.text().slice(0, 300));
    }
  });
  page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));
  const shot = async (name) => {
    const file = `${SHOTS}/${name}.png`;
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  };

  await page.getByTestId('account-onboarding').waitFor({ timeout: 30_000 });
  await page.locator('.segmented button', { hasText: '登录' }).click();
  await page.getByTestId('account-email').fill(EMAIL);
  await page.getByTestId('account-password').fill(PASSWORD);
  await page.getByTestId('account-submit').click();
  await page.getByTestId('shell').waitFor({ timeout: 30_000 });
  record('ui.login', true, `logged in as ${EMAIL}`);

  // a) automations page: trigger card with capability id + 下次运行
  await page.getByTestId('nav-automations').click();
  await page.getByTestId('automations-page').waitFor({ timeout: 15_000 });
  const automationCard = page.locator('.automation-list article', { hasText: 'workbench.agent_prompt' });
  await automationCard.first().waitFor({ timeout: 15_000 });
  const cardText = (await automationCard.first().textContent()) ?? '';
  record(
    'ui.automations_page',
    cardText.includes('workbench.agent_prompt') && cardText.includes('下次运行'),
    `card: ${cardText.replace(/\s+/g, ' ').slice(0, 140)}`
  );
  await shot('a-automations-page');

  // b) triggers page: trigger row + firings history
  await automationCard.first().getByRole('link', { name: /管理规则/ }).click();
  await page.getByTestId('triggers-page').waitFor({ timeout: 15_000 });
  await page.getByTestId(`trigger-row-${triggerId}`).waitFor({ timeout: 15_000 });
  // firings load asynchronously (loadFirings); wait until the section shows this trigger
  await page.waitForFunction(
    (id) => document.querySelector('[data-testid="trigger-firings"]')?.textContent?.includes(id),
    triggerId,
    { timeout: 15_000 }
  );
  const firingsText = (await page.getByTestId('trigger-firings').textContent()) ?? '';
  record(
    'ui.triggers_page',
    firingsText.includes(triggerId) && firingsText.includes('succeeded'),
    `trigger-row-${triggerId} visible; firings section ${firingsText.includes('succeeded') ? 'shows succeeded run' : 'MISSING succeeded run'}`
  );
  await shot('b-triggers-page');

  // c) home: automation conversation shows in the conversation tabs
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-page').waitFor({ timeout: 15_000 });
  const conversationTab = page.locator('.assistant-conversation-tabs button', { hasText: MARKER });
  await conversationTab.first().waitFor({ timeout: 15_000 });
  record('ui.conversation_tab', true, `conversation tab title: ${(await conversationTab.first().textContent())?.trim()}`);
  await shot('c-home-conversation-tab');
} catch (error) {
  record('script-error', false, String(error).slice(0, 500));
  try {
    const page = app ? await app.firstWindow() : null;
    if (page) {
      await page.screenshot({ path: `${SHOTS}/error-state.png` });
      const diag = await page.evaluate(() => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { sel, present: false };
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            sel, present: true,
            rect: { w: r.width, h: r.height },
            display: cs.display, visibility: cs.visibility, opacity: cs.opacity
          };
        };
        return [
          pick('[data-testid="shell"]'),
          pick('[data-testid="automations-page"]'),
          pick('[data-testid="triggers-page"]'),
          pick('.assistant-conversation-tabs')
        ];
      });
      console.log('diagnostics:', JSON.stringify(diag, null, 2));
    }
  } catch { /* best effort */ }
} finally {
  // ---- cleanup: disable the trigger (version may have moved; refetch) ----
  if (token && triggerId) {
    try {
      const list = await api(token, 'GET', '/api/triggers');
      const current = (list.data?.triggers ?? []).find((item) => item.trigger_id === triggerId);
      if (current && current.status !== 'paused') {
        const disabled = await api(token, 'POST', `/api/triggers/${triggerId}/disable`, {
          expected_version: current.version
        });
        record('cleanup.disable', disabled.status === 200, `status=${disabled.status} state=${disabled.data?.status}`);
      } else {
        record('cleanup.disable', true, `already ${current?.status ?? 'absent'}`);
      }
    } catch (error) {
      record('cleanup.disable', false, String(error).slice(0, 200));
    }
  }
  if (app) await app.close();
  if (userData) await fs.rm(userData, { recursive: true, force: true });

  console.log('\n==== SUMMARY ====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.flow} ${r.note}`);
  console.log(`marker: ${MARKER}`);
  if (timings.naturalWaitMs !== undefined) {
    console.log(`natural cron wait: ${(timings.naturalWaitMs / 1000).toFixed(1)}s`);
  }
  console.log(
    `llm reply: ${timings.llmReplyMs == null ? 'not observed within 120s' : `observed after ${timings.llmReplyMs}ms`}`
  );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
