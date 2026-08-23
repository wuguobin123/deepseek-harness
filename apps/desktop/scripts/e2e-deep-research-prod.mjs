// Deep research 生产 E2E 验收：真实后端 + 真实模型 + 真实搜索链。
// 流程：注册临时账号 → 建会话 → deep_mode=true 发起研究问题 →
// 收集 SSE 事件 → 拉取 artifacts 与用量 → 输出验收摘要 JSON。
// 用法：node apps/desktop/scripts/e2e-deep-research-prod.mjs
// 环境变量：E2E_BASE_URL（默认生产公网入口）、E2E_QUESTION
const BASE = process.env.E2E_BASE_URL ?? 'http://119.45.252.25:18080';
const QUESTION =
  process.env.E2E_QUESTION ?? '2026 年中国新能源汽车购置税减免政策有哪些变化？';

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

const summary = {
  base: BASE,
  question: QUESTION,
  sse: {},
  progressStages: [],
  answerChars: 0,
  citationRefs: 0,
  hasReferenceSection: false,
  artifacts: [],
  usage: null,
  error: null
};

// 1. 注册临时账号（生产要求邮箱验证码：E2E_EMAIL/E2E_EMAIL_CODE 由编排侧注入，
//    验证码记录由服务端内省铸造，见 AGENTS.md 部署 SOP）
const email = process.env.E2E_EMAIL ?? `e2e-deep-${Date.now()}@example.com`;
const signupBody = { email, password: 'e2e-pass-123', display_name: 'DeepE2E' };
if (process.env.E2E_EMAIL_CODE) signupBody.verification_code = process.env.E2E_EMAIL_CODE;
const signup = await (await api('POST', '/api/auth/signup', {
  body: signupBody
})).json();
const token = signup.api_key ?? signup.apiKey ?? signup.token ?? signup.access_token;
if (!token) throw new Error(`signup 未返回 api_key: ${JSON.stringify(signup).slice(0, 300)}`);
summary.email = email;

// 2. 建会话
const conv = await (await api('POST', '/api/conversations', {
  token,
  body: { title: 'deep-research-e2e' }
})).json();
const conversationId = conv.conversation_id ?? conv.conversationId ?? conv.id;
summary.conversationId = conversationId;

// 3. deep_mode 流式研究
console.log('提问:', QUESTION);
const startedAt = Date.now();
const res = await api('POST', `/api/conversations/${conversationId}/assistant/stream`, {
  token,
  body: {
    client_message_id: `e2e-${Date.now()}`,
    message: QUESTION,
    deep_mode: true
  }
});
const text = await res.text();
summary.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

let finalAnswer = '';
for (const block of text.split('\n\n')) {
  const line = block.split('\n').find((l) => l.startsWith('data:'));
  if (!line) continue;
  let event;
  try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
  summary.sse[event.type] = (summary.sse[event.type] ?? 0) + 1;
  if (event.type === 'error') summary.error = event.error ?? event;
  if (event.type === 'progress' && event.stage) {
    summary.progressStages.push(event.stage);
  }
  if ((event.type === 'replace' || event.type === 'final') && event.text) {
    finalAnswer = event.text;
  }
}
if (!finalAnswer) {
  // 部分服务端实现把最终答案放在 completed 帧的 message 里
  const completed = text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .find((e) => e && (e.type === 'completed' || e.type === 'done'));
  finalAnswer = completed?.text ?? completed?.answer ?? '';
}
summary.answerChars = finalAnswer.length;
summary.citationRefs = (finalAnswer.match(/\[\d+\]/g) ?? []).length;
summary.hasReferenceSection = /参考来源|参考资料|References/i.test(finalAnswer);
console.log(`SSE 事件: ${JSON.stringify(summary.sse)}  耗时 ${summary.elapsedSeconds}s`);
console.log(`答案 ${summary.answerChars} 字符, 引用标记 ${summary.citationRefs} 个, 参考来源段=${summary.hasReferenceSection}`);

// 4. 会话 artifacts（deep research HTML 报告）
try {
  const artifacts = await (await api('GET', `/api/conversations/${conversationId}/artifacts`, { token })).json();
  summary.artifacts = (artifacts.artifacts ?? []).map((a) => ({
    id: a.artifact_id ?? a.artifactId ?? a.id,
    name: a.display_name ?? a.displayName ?? a.name,
    mime: a.mime_type ?? a.mimeType
  }));
} catch (exc) {
  summary.artifactsError = String(exc);
}
console.log('artifacts:', JSON.stringify(summary.artifacts));

// 5. 钱包用量（验证计费链路未受影响）
try {
  const usage = await (await api('GET', '/api/model-accounts/usage', { token })).json();
  summary.usage = {
    summaryRows: (usage.summary ?? []).length,
    events: (usage.events ?? []).length,
    totalCostMicros: (usage.events ?? []).reduce((acc, e) => acc + (e.cost_micros ?? e.costMicros ?? 0), 0)
  };
} catch (exc) {
  summary.usageError = String(exc);
}
console.log('usage:', JSON.stringify(summary.usage));

console.log('---SUMMARY---');
console.log(JSON.stringify(summary, null, 2));
