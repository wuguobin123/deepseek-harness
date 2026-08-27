/** `trajectory` namespace dictionaries (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'
  | 'timeline.aria'
  | 'timeline.overview'
  | 'timeline.noTiming'
  | 'timeline.loadEarlier'
  | 'timeline.loadingEarlier'
  | 'timeline.total'
  | 'timeline.started'
  | 'timeline.ttft'
  | 'timeline.decoding'
  | 'common.input' | 'common.output' | 'common.think' | 'common.time'
  | 'common.model' | 'common.tools'
  | 'common.status' | 'common.duration' | 'common.tokens' | 'common.reasoning' | 'common.content'
  | 'common.failed' | 'common.pending' | 'common.completed' | 'common.summary' | 'common.preview'
  | 'common.raw' | 'common.source' | 'common.payload' | 'common.result' | 'common.schema' | 'common.timing'
  | 'common.usage' | 'common.options' | 'common.eventDetails' | 'common.close' | 'common.resize'
  | 'common.loadingTrajectory' | 'common.noOutput' | 'common.noSystemPrompt' | 'common.noUsage'
  | 'common.noOptions' | 'common.noSource'
  | 'common.systemPrompt' | 'common.diff' | 'common.parameters' | 'common.started'
  | 'common.thinking'
  | 'common.request' | 'common.turn' | 'common.step' | 'common.betweenTurns' | 'common.noContent' | 'common.compactionUpdated' | 'common.toolsUpdated' | 'common.systemPromptUpdated' | 'common.systemPromptAndToolsUpdated'
  | 'common.purpose' | 'common.compaction' | 'common.provider' | 'common.modelLabel' | 'common.toolCalls'
  | 'common.subtoolCalls' | 'common.error' | 'common.retry' | 'common.retryDelay' | 'common.scheduled'
  | 'common.of' | 'common.dragResize'
  | 'kind.system' | 'kind.user' | 'kind.context' | 'kind.compacted' | 'kind.message' | 'kind.tool' | 'kind.subtool'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'view.trajectory': '轨迹',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': '时长',
  'toolbar.useActualDuration': '使用实际时长',
  'toolbar.useEqualWidth': '使用等宽操作',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': '轮次', 'toolbar.expandTurns': '展开轮次', 'toolbar.collapseTurns': '折叠轮次',
  'toolbar.calls': '调用', 'toolbar.expandCalls': '展开调用', 'toolbar.collapseCalls': '折叠调用',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
  'timeline.aria': '轨迹时间线', 'timeline.overview': '时间线概览，可水平拖动以聚焦事件',
  'timeline.noTiming': '暂无计时数据', 'timeline.loadEarlier': '加载更早历史', 'timeline.loadingEarlier': '正在加载更早历史…',
  'timeline.total': '总计', 'timeline.started': '开始于', 'timeline.ttft': '首 Token 延迟', 'timeline.decoding': '解码',
  'common.input': '输入', 'common.output': '输出', 'common.think': '思考', 'common.time': '时间',
  'common.model': '模型', 'common.tools': '工具',
  'common.status': '状态', 'common.duration': '时长', 'common.tokens': 'Token', 'common.reasoning': '推理', 'common.content': '内容',
  'common.failed': '失败', 'common.pending': '进行中', 'common.completed': '已完成', 'common.summary': '摘要', 'common.preview': '预览',
  'common.raw': '原始内容', 'common.source': '来源', 'common.payload': '载荷', 'common.result': '结果', 'common.schema': 'Schema', 'common.timing': '计时',
  'common.usage': '用量', 'common.options': '选项', 'common.eventDetails': '事件详情', 'common.close': '关闭详情', 'common.resize': '调整事件详情大小',
  'common.loadingTrajectory': '正在加载轨迹…', 'common.noOutput': '无输出', 'common.noSystemPrompt': '此请求没有系统提示词', 'common.noUsage': '未报告用量',
  'common.noOptions': '未记录选项', 'common.noSource': '未记录来源',
  'common.systemPrompt': '系统提示词', 'common.diff': '差异', 'common.parameters': '参数', 'common.started': '开始时间',
  'common.thinking': '思考',
  'common.request': '请求', 'common.turn': '轮次', 'common.step': '步骤', 'common.betweenTurns': '轮次之间', 'common.noContent': '无内容', 'common.compactionUpdated': '压缩已更新', 'common.toolsUpdated': '工具已更新', 'common.systemPromptUpdated': '系统提示词已更新', 'common.systemPromptAndToolsUpdated': '系统提示词和工具已更新',
  'common.purpose': '用途', 'common.compaction': '压缩', 'common.provider': '提供商', 'common.modelLabel': '模型', 'common.toolCalls': '工具调用',
  'common.subtoolCalls': '子工具调用', 'common.error': '错误', 'common.retry': '重试', 'common.retryDelay': '重试延迟', 'common.scheduled': '已安排', 'common.of': '共', 'common.dragResize': '拖动调整大小。双击重置。',
  'kind.system': '系统', 'kind.user': '用户', 'kind.context': '上下文', 'kind.compacted': '已压缩', 'kind.message': '助手', 'kind.tool': '工具', 'kind.subtool': '子工具',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
  'timeline.aria': 'Trajectory timeline', 'timeline.overview': 'Timeline overview; drag horizontally to focus events',
  'timeline.noTiming': 'No timing data', 'timeline.loadEarlier': 'Load earlier history', 'timeline.loadingEarlier': 'Loading earlier history…',
  'timeline.total': 'Total', 'timeline.started': 'Started', 'timeline.ttft': 'TTFT', 'timeline.decoding': 'Decoding',
  'common.input': 'Input', 'common.output': 'Output', 'common.think': 'Think', 'common.time': 'Time',
  'common.model': 'Model', 'common.tools': 'Tools',
  'common.status': 'Status', 'common.duration': 'Duration', 'common.tokens': 'Tokens', 'common.reasoning': 'Reasoning', 'common.content': 'Content',
  'common.failed': 'Failed', 'common.pending': 'Pending', 'common.completed': 'Completed', 'common.summary': 'Summary', 'common.preview': 'Preview',
  'common.raw': 'Raw', 'common.source': 'Source', 'common.payload': 'Payload', 'common.result': 'Result', 'common.schema': 'Schema', 'common.timing': 'Timing',
  'common.usage': 'Usage', 'common.options': 'Options', 'common.eventDetails': 'Event details', 'common.close': 'Close details', 'common.resize': 'Resize event details',
  'common.loadingTrajectory': 'Loading trajectory…', 'common.noOutput': 'No output', 'common.noSystemPrompt': 'No system prompt in this request', 'common.noUsage': 'Usage not reported',
  'common.noOptions': 'Options not recorded', 'common.noSource': 'Source not recorded',
  'common.systemPrompt': 'System Prompt', 'common.diff': 'Diff', 'common.parameters': 'Parameters', 'common.started': 'Started',
  'common.thinking': 'Thinking',
  'common.request': 'Request', 'common.turn': 'Turn', 'common.step': 'Step', 'common.betweenTurns': 'Between turns', 'common.noContent': 'No content', 'common.compactionUpdated': 'Compaction updated', 'common.toolsUpdated': 'Tools updated', 'common.systemPromptUpdated': 'System Prompt Updated', 'common.systemPromptAndToolsUpdated': 'System Prompt and Tools Updated',
  'common.purpose': 'Purpose', 'common.compaction': 'Compaction', 'common.provider': 'Provider', 'common.modelLabel': 'Model', 'common.toolCalls': 'Tool calls',
  'common.subtoolCalls': 'Subtool calls', 'common.error': 'Error', 'common.retry': 'Retry', 'common.retryDelay': 'Retry delay', 'common.scheduled': 'Scheduled', 'common.of': 'of', 'common.dragResize': 'Drag to resize. Double-click to reset.',
  'kind.system': 'SYSTEM', 'kind.user': 'USER', 'kind.context': 'CONTEXT', 'kind.compacted': 'COMPACTED', 'kind.message': 'ASSISTANT', 'kind.tool': 'TOOL', 'kind.subtool': 'SUBTOOL',
}
