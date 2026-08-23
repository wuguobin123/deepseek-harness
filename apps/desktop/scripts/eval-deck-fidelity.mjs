// Deck 全保真测评：真实后端 + 真实模型，验证 frontend-slides 是否走自定义 HTML 通道。
// 流程：注册临时账号 → 建会话 → /assistant/stream 发起 4 页 deck 请求 →
// 收集 SSE 事件（工具调用/产物）→ 读取生成的 HTML → Playwright 截图每页。
// 用法：node scripts/eval-deck-fidelity.mjs  （需本地后端 127.0.0.1:8000 运行中）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.env.EVAL_BASE_URL ?? 'http://127.0.0.1:8000';
const OUT_DIR = path.resolve(import.meta.dirname, '../../../docs/screenshots/eval-deck-fidelity');
const QUESTION =
  process.env.EVAL_QUESTION ??
  '帮我做一份 4 页的《多 Agent 协作模式》演示文稿，风格要大胆有设计感';
const DB = path.resolve(import.meta.dirname, '../../../data/customer_service.workbench.sqlite3');

async function api(method, url, { token, body } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-API-Key': token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${await res.text()}`);
  return res;
}

const report = { question: QUESTION, events: {}, toolCalls: [], artifacts: [], screenshots: [] };

// 1. 注册临时账号
const email = `eval-deck-${Date.now()}@example.com`;
const signup = await (await api('POST', '/api/auth/signup', {
  body: { email, password: 'eval-pass-123', display_name: 'DeckEval' }
})).json();
const token = signup.api_key ?? signup.apiKey ?? signup.token ?? signup.access_token;
if (!token) throw new Error(`signup 未返回 api_key: ${JSON.stringify(signup).slice(0, 300)}`);

// 2. 建会话
const conv = await (await api('POST', '/api/conversations', {
  token,
  body: { title: 'deck-fidelity-eval' }
})).json();
const conversationId = conv.conversation_id ?? conv.conversationId ?? conv.id;
if (!conversationId) throw new Error(`建会话失败: ${JSON.stringify(conv).slice(0, 300)}`);

// 3. 流式发起 deck 请求
console.log('提问:', QUESTION);
const res = await api('POST', `/api/conversations/${conversationId}/assistant/stream`, {
  token,
  body: { client_message_id: `eval-${Date.now()}`, message: QUESTION }
});
const text = await res.text();
for (const block of text.split('\n\n')) {
  const line = block.split('\n').find((l) => l.startsWith('data:'));
  if (!line) continue;
  let event;
  try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
  report.events[event.type] = (report.events[event.type] ?? 0) + 1;
  if (event.type === 'tool_call' && event.tool_call) {
    report.toolCalls.push({
      capability: event.tool_call.capability_id,
      hasHtml: JSON.stringify(event.tool_call.arguments ?? {}).includes('"html"')
    });
  }
}
console.log('事件统计:', JSON.stringify(report.events));
console.log('工具调用:', report.toolCalls.map((t) => t.capability + (t.hasHtml ? '(html)' : '')).join(' -> '));

// 3.5 从消息元数据取真实工具调用链与最终回答（SSE 不直接流式工具调用）
const meta = execFileSync('sqlite3', [
  DB,
  `SELECT metadata_json FROM wb_messages WHERE conversation_id='${conversationId}' AND role='assistant' ORDER BY created_at DESC LIMIT 1;`
]).toString().trim();
if (meta) {
  const parsed = JSON.parse(meta);
  report.invoked = parsed.invoked_capability_ids ?? [];
  report.agentTurns = parsed.agent_turns;
  console.log('invoked:', (report.invoked ?? []).join(' -> '));
}
const answer = execFileSync('sqlite3', [
  DB,
  `SELECT substr(content_json,1,600) FROM wb_messages WHERE conversation_id='${conversationId}' AND role='assistant' ORDER BY created_at DESC LIMIT 1;`
]).toString().trim();
console.log('回答片段:', answer.slice(0, 400));

// 4. 从本地 DB 取本次会话最新 HTML artifact 的存储路径（同机测评，免下载接口）
const row = execFileSync('sqlite3', [
  DB,
  `SELECT storage_uri FROM wb_artifacts WHERE conversation_id='${conversationId}' AND mime_type='text/html' ORDER BY created_at DESC LIMIT 1;`
]).toString().trim();
if (!row) throw new Error('未找到生成的 HTML artifact');
console.log('HTML artifact:', row);
const html = await fs.readFile(row, 'utf-8');
report.htmlBytes = Buffer.byteLength(html);
report.customSlides = (html.match(/class="slide custom"/g) ?? []).length;
report.structuredSlides = (html.match(/class="slide (?!custom)/g) ?? []).length;

// 5. Playwright 截图每一页
await fs.mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(600);
const slideCount = await page.locator('[data-slide]').count();
for (let i = 0; i < slideCount; i += 1) {
  const shot = path.join(OUT_DIR, `slide-${String(i + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: shot });
  report.screenshots.push(shot);
  if (i < slideCount - 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  }
}
await browser.close();

console.log(JSON.stringify({
  customSlides: report.customSlides,
  structuredSlides: report.structuredSlides,
  htmlBytes: report.htmlBytes,
  screenshots: report.screenshots
}, null, 2));
