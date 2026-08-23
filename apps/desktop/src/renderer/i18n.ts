/**
 * Lightweight i18n helper for the renderer.
 *
 * The desktop client ships in Chinese (zh-CN) for now. The ``t()``
 * function looks up a key in the active locale dictionary and falls
 * back to the key itself (or a provided default) when the lookup
 * misses, so future locales can plug in without touching every
 * component.
 *
 * Enum tables (severity, status, trigger type) are exported as plain
 * objects so the UI can render the Chinese label of any backend value
 * without bespoke switch statements.
 */

export type Locale = 'zh-CN' | 'en';

const dictionaries: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    'app.title': '企业 AI 工作台',
    'app.boot.loading': '正在加载…',
    'app.nav.telesales': '电话销售',
    'app.nav.anomalies': '异常',
    'app.nav.triggers': '触发器',
    'app.nav.history': '执行历史',
    'app.nav.knowledge': '知识库',
    'app.nav.settings': '设置',
    'common.refresh': '刷新',
    'common.loading': '加载中…',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
    'common.test': '试触发',
    'common.enable': '启用',
    'common.disable': '停用',
    'common.archive': '归档',
    'common.create': '新建',
    'common.submit': '提交',
    'common.error': '出错了',
    'common.retry': '重试',
    'common.back': '返回',
    'common.close': '关闭',
    'common.optional': '可选',
    'common.required': '必填',
    'common.saved': '已保存',
    'common.untitled': '未命名',
    'common.unknown': '未知',

    'anomalies.title': '异常队列',
    'anomalies.subtitle': '失败 / 需确认 / 越权 case，按时间倒序展示。',
    'anomalies.filter.status': '状态',
    'anomalies.filter.severity': '严重度',
    'anomalies.filter.owner': '负责人',
    'anomalies.filter.all': '全部',
    'anomalies.empty': '当前筛选下没有异常。',
    'anomalies.loading': '正在加载异常…',
    'anomalies.error.load': '加载异常失败，请检查网络和 API Key 后重试。',
    'anomalies.count_one': '共 {count} 条异常',
    'anomalies.count_other': '共 {count} 条异常',
    'anomalies.card.occurrences': '发生 {count} 次',
    'anomalies.card.lastSeen': '最近出现 {time}',
    'anomalies.card.openDetail': '查看详情',
    'anomalies.card.resolve': '标记已解决',
    'anomalies.card.ignore': '忽略',
    'anomalies.detail.title': '异常详情',
    'anomalies.detail.timeline': '时间线',
    'anomalies.detail.command': '关联命令',
    'anomalies.detail.snapshot': '数据快照',
    'anomalies.detail.conversation': '修复对话',
    'anomalies.detail.verification': '验证',
    'anomalies.detail.approve': '审批通过',
    'anomalies.detail.open': '在业务系统中打开',
    'anomalies.detail.resolve.title': '标记已解决',
    'anomalies.detail.resolve.reason': '原因（必填）',
    'anomalies.detail.resolve.placeholder': '例如：在 OA 系统中手动确认。',
    'anomalies.detail.ignore.title': '忽略此异常',
    'anomalies.detail.ignore.reason': '原因（必填）',
    'anomalies.detail.ignore.placeholder': '例如：重复告警，已通知本人。',
    'anomalies.detail.snapshot.empty': '暂无快照。',
    'anomalies.detail.snapshot.capturedAt': '采集于',
    'anomalies.detail.noConversation': '尚无修复对话。在下方输入框向 AI 提问。',
    'anomalies.detail.placeholder': '例如：帮我重新提交一次请假申请。',
    'anomalies.detail.send': '发送',
    'anomalies.detail.sending': 'AI 正在思考…',
    'anomalies.detail.proposed': '建议执行：',
    'anomalies.detail.proposed.unknown': '该动作不在此 case 允许的修复能力集合内。',

    'triggers.title': '触发器',
    'triggers.subtitle': 'cron / 事件 / 条件三类自动触发。',
    'triggers.new': '新建触发器',
    'triggers.empty': '还没有触发器。',
    'triggers.loading': '正在加载触发器…',
    'triggers.error.load': '加载触发器失败。',
    'triggers.form.capability': '目标能力',
    'triggers.form.plugin': '所属插件',
    'triggers.form.type': '触发类型',
    'triggers.form.cron': 'Cron 表达式',
    'triggers.form.timezone': '时区',
    'triggers.form.arguments': '参数 (JSON)',
    'triggers.form.test': '试触发一次',
    'triggers.form.testHint': '会立即调度一次 firing（不会真的发外部副作用）。',
    'triggers.form.save': '保存',
    'triggers.form.saved': '触发器已保存。',
    'triggers.form.error': '保存失败',
    'triggers.nextFireAt': '下次触发',
    'triggers.lastFiredAt': '上次触发',
    'triggers.noNextFireAt': '未调度',

    'history.title': '执行历史',
    'history.subtitle': '查看触发器、命令、对话和异常的执行链路。',
    'history.empty': '暂无执行记录。触发器开始调度后这里会显示完整链路。',
    'history.loading': '正在加载历史…',
    'history.error.load': '加载历史失败。',

    'knowledge.title': '知识库',
    'knowledge.subtitle': '管理组织知识并为助手提供可追溯的引用来源。',
    'knowledge.empty': '知识库待接入。当前可作为 case 修正的引用来源，后续会接入 RAG。',
    'knowledge.placeholder': '输入关键字搜索知识库',
    'knowledge.search': '搜索',

    'settings.title': '设置',
    'settings.subtitle': '配置服务地址和当前工作空间身份。',
    'settings.section.connection': '后端连接',
    'settings.section.session': '会话身份',
    'settings.baseUrl': '后端 Base URL',
    'settings.tenantId': '租户 ID',
    'settings.actorId': '操作人 ID',
    'settings.actorRole': '角色',
    'settings.teamId': '团队 ID',
    'settings.apiKey': 'API Key（加密保存到本机）',
    'settings.adminKey': '管理员 Key（仅在调试时使用）',
    'settings.saved': '已保存',
    'settings.error.save': '保存失败',
    'settings.placeholder.baseUrl': 'http://119.45.252.25:18080',
    'settings.placeholder.tenantId': '输入租户 ID',
    'settings.placeholder.actorId': '输入操作人 ID',
    'settings.placeholder.teamId': 'team-1',
    'settings.placeholder.apiKey': '输入 API Key',
    'settings.saveAndConnect': '保存并进入工作台',
    'settings.testConnection': '测试连接',
    'settings.testing': '测试中…',
    'settings.test.ok': '连接正常 ✓',
    'settings.test.failed': '连接失败：{message}',

    'tooltip.refresh': '重新加载',
    'tooltip.testFire': '立即触发一次（调试用）',
    'tooltip.openExternal': '在浏览器中打开业务系统页面',
    'tooltip.archive': '归档（保留审计与历史）',
    'tooltip.resolve': '此异常已修复，标记为已解决',
    'tooltip.ignore': '忽略此异常（不会再出现在队列里）',
    'tooltip.claim': '认领此异常，负责跟进',
    'tooltip.sendMessage': '发送消息给 AI 助手'
  },
  en: {} // fallback to key
};

let activeLocale: Locale = 'zh-CN';

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[activeLocale] ?? {};
  let value = dict[key];
  if (value === undefined) {
    value = key;
  }
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Enum label tables
// ---------------------------------------------------------------------------

export const SEVERITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '紧急'
};

export const ANOMALY_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  fixing: '处理中',
  awaiting_approval: '待审批',
  verifying: '验证中',
  resolved: '已解决',
  ignored: '已忽略'
};

export const TRIGGER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  enabled: '已启用',
  paused: '已暂停',
  error: '异常',
  archived: '已归档'
};

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  at: '执行一次 (At)',
  every: '固定间隔 (Every)',
  cron: '定时 (Cron)',
  event: '事件 (Event)',
  condition: '条件 (Condition)'
};

export const FIRING_STATUS_LABELS: Record<string, string> = {
  scheduled: '已计划',
  dispatching: '分发中',
  queued: '排队中',
  running: '执行中',
  awaiting_approval: '等待审批',
  awaiting_user: '等待用户',
  succeeded: '已成功',
  failed: '失败',
  dead_letter: '已进入死信',
  cancelled: '已取消'
};

export function severityLabel(value: string | null | undefined): string {
  if (!value) return t('common.unknown');
  return SEVERITY_LABELS[value] ?? value;
}

export function anomalyStatusLabel(value: string | null | undefined): string {
  if (!value) return t('common.unknown');
  return ANOMALY_STATUS_LABELS[value] ?? value;
}

export function triggerStatusLabel(value: string | null | undefined): string {
  if (!value) return t('common.unknown');
  return TRIGGER_STATUS_LABELS[value] ?? value;
}

export function firingStatusLabel(value: string | null | undefined): string {
  if (!value) return t('common.unknown');
  return FIRING_STATUS_LABELS[value] ?? value;
}

export function triggerTypeLabel(value: string | null | undefined): string {
  if (!value) return t('common.unknown');
  return TRIGGER_TYPE_LABELS[value] ?? value;
}
