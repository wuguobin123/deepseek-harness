import React from 'react';
import type { AssistantSource, Command, CommandStep } from './types';
import {
  IconChevronRight,
  IconDownload,
  IconExternal,
  IconEye,
  IconFile,
  IconFileExcel,
  IconFilePdf,
  IconFilePpt,
  IconFileWord,
  IconFileText,
  IconGlobe,
  IconPaperclip,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShield,
  IconSparkles,
  IconStop
} from '../../components/icons';
import {
  useAssistant,
  type AssistantActivity,
  type AssistantMessage,
  type DeepResearchTrace
} from './AssistantContext';
import { BrowserPanel } from '../browser/BrowserPanel';
import { useBrowserWorkspace } from '../browser/BrowserWorkspaceContext';
import { useDocumentPreview } from '../document-preview/DocumentPreviewContext';
import { DocumentPreviewPanel } from '../document-preview/DocumentPreviewPanel';
import { MarkdownContent } from './MarkdownContent';
import { FixSuggestionButtons } from '../../components/FixSuggestionButtons';
import { workbenchApi, type PromptSkillSummary } from '../../api';
import type { KnowledgeBase } from '../../../shared/contracts';
import {
  generatedFileRows,
  isHtmlGeneratedFile,
  type GeneratedFileArtifact
} from './generated-files';

function sourceTitle(source: AssistantSource): string {
  return source.title || source.uri || source.capabilityId || '业务数据来源';
}

function sourceKindLabel(source: AssistantSource): string {
  if (source.type === 'knowledge' || source.uri?.startsWith('kb:') || source.uri?.startsWith('rag:')) {
    return '知识库';
  }
  if (source.type === 'business' || source.context_type === 'business_fact') {
    return '业务记录';
  }
  if (source.context_type === 'derived_analysis') return '分析结论';
  return '执行结果';
}

function isCitationSource(source: AssistantSource): boolean {
  // Tool results without a stable source URI are execution telemetry, not a
  // citation. Showing their payload here creates a noisy duplicate of the answer.
  return Boolean(
    source.uri &&
      (source.type !== 'tool_result' ||
        source.uri.startsWith('http:') ||
        source.uri.startsWith('https:') ||
        source.uri.startsWith('business:') ||
        source.uri.startsWith('kb:') ||
        source.uri.startsWith('rag:'))
  );
}

function citationSources(sources: AssistantSource[]): AssistantSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!isCitationSource(source)) return false;
    const key = source.uri || `${source.type}:${source.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function artifactIcon(displayName: string): JSX.Element {
  const ext = displayName.split('.').pop()?.toLowerCase() || '';
  if (['docx', 'doc'].includes(ext)) return <IconFileWord size={14} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <IconFileExcel size={14} />;
  if (['pptx', 'ppt'].includes(ext)) return <IconFilePpt size={14} />;
  if (ext === 'pdf') return <IconFilePdf size={14} />;
  if (['md', 'txt'].includes(ext)) return <IconFileText size={14} />;
  return <IconFile size={14} />;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function GeneratedFilesList({
  artifacts
}: {
  artifacts: GeneratedFileArtifact[];
}): JSX.Element | null {
  const { openArtifactExternal } = useDocumentPreview();
  const { openArtifactPreview } = useAssistant();
  if (artifacts.length === 0) return null;
  const rows = generatedFileRows(artifacts);
  return (
    <div className="assistant-generated-files" data-testid="assistant-generated-files">
      <div className="assistant-generated-files__header">
        <IconFile size={13} />
        <strong>生成的文件（{rows.length}）</strong>
      </div>
      <div className="assistant-generated-files__list">
        {rows.map(({ artifact }) => (
          <div key={artifact.artifactId} className="generated-file-card">
            <div className="generated-file-card__icon">
              {artifactIcon(artifact.displayName)}
            </div>
            <div className="generated-file-card__info">
              <strong className="generated-file-card__name">
                {artifact.displayName}
              </strong>
              <small>
                {artifact.displayName.split('.').pop()?.toUpperCase() || '文件'}
                {artifact.sizeBytes ? ` · ${formatFileSize(artifact.sizeBytes)}` : ''}
              </small>
            </div>
            <div className="generated-file-card__actions">
              <button
                type="button"
                className="generated-file-card__btn"
                onClick={() => openArtifactPreview(artifact)}
                title="预览"
                aria-label={`预览 ${artifact.displayName}`}
              >
                <IconEye size={13} />
                预览
              </button>
              {!isHtmlGeneratedFile(artifact) ? (
                <button
                  type="button"
                  className="generated-file-card__btn generated-file-card__btn--primary"
                  onClick={() => void openArtifactExternal(artifact.artifactId)}
                  title="用系统应用打开（PowerPoint/Word/Excel）"
                  aria-label={`打开 ${artifact.displayName}`}
                >
                  <IconDownload size={13} />
                  打开
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function safeExternalUri(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function stepTitle(step: CommandStep, index: number): string {
  return (
    step.label ||
    step.name ||
    step.capabilityId ||
    `执行步骤 ${index + 1}`
  );
}

function commandCanConfirm(command: Command): boolean {
  return command.status === 'awaiting_confirmation' && command.policy.allowed;
}

function commandIsFinished(command: Command): boolean {
  return ['succeeded', 'completed', 'waiting_approval', 'failed', 'cancelled'].includes(
    command.status
  );
}

function commandStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    awaiting_confirmation: '等待确认',
    queued: '排队中',
    running: '执行中',
    waiting_approval: '等待审批',
    succeeded: '已完成',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消'
  };
  return labels[status] ?? status;
}

const COMMAND_STAGES = ['目标', '计划', '审批', '执行', '验证', '完成'] as const;

function commandStage(status: string): number {
  if (status === 'awaiting_confirmation') return 1;
  if (status === 'waiting_approval') return 2;
  if (status === 'queued' || status === 'running') return 3;
  if (status === 'succeeded' || status === 'completed') return 5;
  return 3;
}

function isReadOnlyStep(step: CommandStep): boolean {
  const value = `${step.label ?? ''} ${step.name ?? ''} ${step.capabilityId ?? ''}`.toLowerCase();
  return [
    '.read',
    '.query',
    '.search',
    'analysis',
    'calculate',
    'diagnosis',
    '拉取',
    '读取',
    '查询',
    '计算',
    '分析'
  ].some((token) => value.includes(token));
}

export function SourceList({ sources }: { sources: AssistantSource[] }): JSX.Element | null {
  const citations = citationSources(sources);
  if (citations.length === 0) return null;
  return (
    <details className="assistant-sources">
      <summary>引用和依据（{citations.length}）</summary>
      <ul>
        {citations.map((source, index) => {
          const externalUri = safeExternalUri(source.uri);
          return (
          <li key={`${source.uri ?? source.title ?? 'source'}-${index}`}>
            <div>
              <strong>
                <span className="assistant-source__kind">{sourceKindLabel(source)}</span>
                {sourceTitle(source)}
              </strong>
              {(source.abstract || source.snippet) && (
                <p>{source.abstract || source.snippet}</p>
              )}
              {typeof source.score === 'number' ? (
                <small className="assistant-source__score">
                  匹配度 {(source.score * 100).toFixed(0)}%
                </small>
              ) : null}
            </div>
            {externalUri ? (
              <a href={externalUri} target="_blank" rel="noreferrer">
                打开原文 <IconExternal size={12} />
              </a>
            ) : null}
          </li>
          );
        })}
      </ul>
    </details>
  );
}

const ACTIVITY_LABELS: Record<string, string> = {
  accepted: '整理问题与可用信息',
  context_restored: '加载会话上下文',
  reasoning: '判断下一步',
  tool_start: '执行查询',
  tool_result: '核对查询结果',
  completion_retry: '补充必要信息',
  completion_ready: '检查回答完整性'
};

const CAPABILITY_LABELS: Record<string, string> = {
  'workbench.knowledge_search': '知识库检索',
  'workbench.weather': '天气查询',
  'workbench.web_search': '公开网页搜索',
  'workbench.url_fetch': '网页内容读取',
  'workbench.github_search': 'GitHub 检索',
  'workbench.browser_extract': '浏览器内容提取',
  'workbench.memory_search': '历史信息检索',
  'workbench.file_analyze': '文件分析',
  'workbench.image_understand': '图片理解'
};

function capabilityLabel(capabilityId?: string): string {
  if (!capabilityId) return '相关能力';
  return CAPABILITY_LABELS[capabilityId] ?? capabilityId.replace(/^workbench\./, '');
}

function activityDescription(activity: AssistantActivity): string {
  const capability = capabilityLabel(activity.capabilityId);
  switch (activity.phase) {
    case 'accepted':
      return '开始整理问题、相关上下文和可用信息。';
    case 'context_restored':
      return '已加载本次会话中相关的历史信息与可用能力。';
    case 'reasoning':
      return '正在判断回答还需要哪些信息，并规划下一步。';
    case 'tool_start':
      return `正在使用${capability}获取可验证信息。`;
    case 'tool_result':
      return `${capability}已返回结果，正在核对是否可用于回答。`;
    case 'completion_retry':
      return '现有信息还不足，正在补充必要信息。';
    case 'completion_ready':
      return '已检查回答完整性，正在整理最终答复。';
    default:
      return activity.message;
  }
}

export function ActivityTrail({
  activities,
  streaming
}: {
  activities: AssistantActivity[];
  streaming: boolean;
}): JSX.Element | null {
  if (activities.length === 0) return null;
  return (
    <details className="assistant-activity">
      <summary>
        <span className={streaming ? 'is-running' : 'is-complete'} />
        {streaming ? '正在执行' : '执行轨迹'}
        <small>{activities.length} 个步骤</small>
      </summary>
      <ol className="assistant-activity__actions">
        {activities.map((activity) => (
          <li
            key={activity.id}
            className={`activity--${activity.phase}`}
          >
            <span>{activity.turn ?? '·'}</span>
            <div>
              <strong>{ACTIVITY_LABELS[activity.phase] ?? '处理任务'}</strong>
              <small>{activityDescription(activity)}</small>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

function AnswerMessage({
  message
}: {
  message: Extract<AssistantMessage, { kind: 'answer' }>;
}): JSX.Element {
  const { decideSkillInstallation, decideSkillWorkshop, openAssistant, submit } = useAssistant();
  const allSources = [
    ...message.result.sources,
    ...message.result.supplementalAnswers.flatMap((item) => item.sources)
  ];
  const generatedFiles = (
    (message.result.artifacts ?? []) as GeneratedFileArtifact[]
  ).filter((a) => a.artifactType === 'generated_file' || a.mimeType);
  return (
    <article className="assistant-message assistant-message--answer" data-testid="assistant-answer">
      <div className="assistant-message__author">
        <IconSparkles size={15} />
        <strong>AI 助手</strong>
      </div>
      <ActivityTrail
        activities={message.activities ?? []}
        streaming={Boolean(message.streaming)}
      />
      {message.deepResearch ? (
        <DeepResearchTracePanel trace={message.deepResearch} />
      ) : null}
      {message.result.answer ? (
        <MarkdownContent className="assistant-answer">
          {message.result.answer}
        </MarkdownContent>
      ) : null}
      <FixSuggestionButtons
        suggestions={message.result.fixSuggestions ?? []}
        onAction={(action, payload) => {
          if (action === 'cli_approve_retry') {
            void submit(`批准并重试 CLI：${JSON.stringify({ ...payload, approved: true })}`);
          }
        }}
      />
      {message.streaming ? (
        <div className="assistant-stream-status" data-testid="assistant-stream-status">
          <span className="assistant-stream-cursor" aria-hidden="true" />
          {message.statusText || '正在生成回答…'}
        </div>
      ) : null}
      {message.result.supplementalAnswers.map((item) => (
        <section className="assistant-supplement" key={`${item.kind}-${item.title}`}>
          <strong>{item.title}</strong>
          <MarkdownContent>{item.answer}</MarkdownContent>
        </section>
      ))}
      {generatedFiles.length > 0 ? (
        <GeneratedFilesList artifacts={generatedFiles} />
      ) : null}
      {(message.skillInstallProposals ?? (
        message.skillInstallProposal ? [message.skillInstallProposal] : []
      )).map((proposal) => (
        <section
          key={proposal.proposalId}
          className="assistant-skill-install"
          data-testid="assistant-skill-install-proposal"
        >
          <div className="assistant-skill-install__icon">
            <IconShield size={16} />
          </div>
          <div className="assistant-skill-install__body">
            <strong>
              {proposal.action === 'uninstall' ? '卸载 ' : ''}
              {proposal.displayName}
            </strong>
            <small>
              {proposal.skillRef}@{proposal.version}
            </small>
            {proposal.summary ? (
              <p>{proposal.summary}</p>
            ) : null}
            <small>来源：{proposal.registry}</small>
            {(proposal.warnings ?? []).map((warning) => (
              <small key={warning}>警告：{warning}</small>
            ))}
          </div>
          <div className="assistant-skill-install__actions">
            {proposal.status === 'pending' ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    void decideSkillInstallation(
                      message.id,
                      proposal.proposalId,
                      'reject'
                    )
                  }
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="assistant-skill-install-confirm"
                  onClick={() =>
                    void decideSkillInstallation(
                      message.id,
                      proposal.proposalId,
                      'approve'
                    )
                  }
                >
                  {proposal.action === 'uninstall'
                    ? '确认卸载'
                    : '确认安装'}
                </button>
              </>
            ) : (
              <span className={`badge badge--${proposal.status}`}>
                {proposal.status === 'installed'
                  ? '已安装'
                  : proposal.status === 'uninstalled'
                    ? '已卸载'
                    : '已取消'}
              </span>
            )}
          </div>
        </section>
      ))}
      {message.skillWorkshopProposal ? (
        <section
          className="assistant-skill-install"
          data-testid="assistant-skill-workshop-proposal"
        >
          <div className="assistant-skill-install__icon">
            <IconShield size={16} />
          </div>
          <div className="assistant-skill-install__body">
            <strong>{message.skillWorkshopProposal.name}</strong>
            <p>{message.skillWorkshopProposal.description}</p>
            <small>
              {message.skillWorkshopProposal.bodySizeBytes} bytes · 支持文件{' '}
              {message.skillWorkshopProposal.supportFileCount} 个
            </small>
          </div>
          <div className="assistant-skill-install__actions">
            {message.skillWorkshopProposal.status === 'pending' ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    void decideSkillWorkshop(
                      message.id,
                      message.skillWorkshopProposal!.proposalId,
                      'reject'
                    )
                  }
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="assistant-skill-workshop-confirm"
                  onClick={() =>
                    void decideSkillWorkshop(
                      message.id,
                      message.skillWorkshopProposal!.proposalId,
                      'approve'
                    )
                  }
                >
                  确认创建
                </button>
              </>
            ) : (
              <span className={`badge badge--${message.skillWorkshopProposal.status}`}>
                {message.skillWorkshopProposal.status === 'applied' ? '已创建' : '已取消'}
              </span>
            )}
          </div>
        </section>
      ) : null}
      <SourceList sources={allSources} />
      {message.result.suggestedActions.length > 0 ? (
        <div className="assistant-suggestions">
          <span>你还可以继续</span>
          {message.result.suggestedActions.map((action, index) => (
            <button
              type="button"
              className="assistant-suggestion"
              key={action.id ?? `${action.label}-${index}`}
              onClick={() =>
                openAssistant(
                  typeof action.params?.message === 'string'
                    ? action.params.message
                    : action.label
                )
              }
            >
              {action.label}
              <IconChevronRight size={13} />
            </button>
          ))}
        </div>
      ) : null}
      {!message.streaming ? (
        <small className="assistant-trace">trace · {message.result.traceId}</small>
      ) : null}
    </article>
  );
}

function CommandMessage({
  message
}: {
  message: Extract<AssistantMessage, { kind: 'command' }>;
}): JSX.Element {
  const {
    busy,
    confirmCommand,
    cancelCommand,
    executeCommandAction,
    retryMessage,
    saveAsAutomation
  } = useAssistant();
  const command = message.response.command;
  const nextActions = command.execution.nextActions ?? [];
  const stepResults = command.execution.stepResults ?? [];
  const writeSteps = command.steps.filter((step) => !isReadOnlyStep(step)).length;
  return (
    <article className="assistant-message assistant-message--command" data-testid="assistant-command">
      <div className="assistant-message__author">
        <IconSparkles size={15} />
        <strong>AI 助手</strong>
        <span className={`assistant-command__status status--${command.status}`}>
          {commandStatusLabel(command.status)}
        </span>
      </div>
      <p>{message.response.message}</p>
      <ol
        className="command-stage-rail"
        aria-label="任务阶段"
        data-testid="command-stage-rail"
      >
        {COMMAND_STAGES.map((stage, index) => {
          const current = commandStage(command.status);
          const state = index < current ? 'complete' : index === current ? 'current' : 'pending';
          return (
            <li className={`is-${state}`} key={stage}>
              <span>{index + 1}</span>
              <strong>{stage}</strong>
            </li>
          );
        })}
      </ol>
      <section className="command-plan">
        <h3>执行计划</h3>
        <ol>
          {command.steps.map((step, index) => (
            <li key={step.stepId ?? `${step.capabilityId ?? 'step'}-${index}`}>
              <span className="command-plan__index">{index + 1}</span>
              <div>
                <strong>{stepTitle(step, index)}</strong>
                <small>{step.capabilityId ?? step.agent ?? '平台能力'}</small>
              </div>
              <span className={isReadOnlyStep(step) ? 'step-read' : 'step-write'}>
                {isReadOnlyStep(step) ? '只读' : '写入'}
              </span>
            </li>
          ))}
        </ol>
      </section>
      {stepResults.length > 0 ? (
        <section className="command-results" data-testid="command-results">
          <h3>执行结果</h3>
          <ol>
            {stepResults.map((result, index) => {
              const stepId =
                typeof result.stepId === 'string'
                  ? result.stepId
                  : typeof result.step_id === 'string'
                    ? result.step_id
                    : '';
              const plannedStep = command.steps.find((step) => step.stepId === stepId);
              const resultMessage =
                typeof result.message === 'string' && result.message.trim()
                  ? result.message
                  : '该步骤已完成并保存结果';
              const objectType =
                typeof result.objectType === 'string'
                  ? result.objectType
                  : typeof result.object_type === 'string'
                    ? result.object_type
                    : '';
              const objectId =
                typeof result.objectId === 'string'
                  ? result.objectId
                  : typeof result.object_id === 'string'
                    ? result.object_id
                    : '';
              return (
                <li key={stepId || `${resultMessage}-${index}`}>
                  <span className="command-result__check">✓</span>
                  <div>
                    <strong>
                      {plannedStep ? stepTitle(plannedStep, index) : `步骤 ${index + 1}`}
                    </strong>
                    <p>{resultMessage}</p>
                    {objectType || objectId ? (
                      <small>{[objectType, objectId].filter(Boolean).join(' · ')}</small>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <div className="command-impact">
        <div>
          <span>影响范围</span>
          <strong>{command.steps.length} 个步骤，涉及 {writeSteps} 个写入动作</strong>
        </div>
        <div>
          <span>权限说明</span>
          <strong>
            {command.policy.allowed
              ? '当前角色已授权执行'
              : `需要 ${command.policy.allowedRoles.join(' / ') || '更高权限'}`
            }
          </strong>
        </div>
      </div>
      {command.policy.blockers.length > 0 ? (
        <p className="command-warning">{command.policy.blockers.join('；')}</p>
      ) : null}
      {commandCanConfirm(command) ? (
        <div className="command-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void cancelCommand(message.id, command)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void confirmCommand(message.id, command)}
            data-testid="confirm-command"
          >
            <IconPlay size={14} />
            确认并执行
          </button>
          <small><IconShield size={12} /> 执行前不会写入业务系统</small>
        </div>
      ) : null}
      {nextActions.length > 0 ? (
        <div className="command-next-actions">
          <strong>需要继续确认</strong>
          {nextActions
            .filter((action) => !action.status || action.status === 'pending')
            .map((action) => (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                key={action.actionId}
                onClick={() =>
                  void executeCommandAction(message.id, command, action.actionId)
                }
              >
                {action.label ?? '审批并继续'}
              </button>
            ))}
        </div>
      ) : null}
      {command.status === 'failed' ? (
        <button
          type="button"
          className="assistant-retry"
          disabled={busy}
          onClick={() => void retryMessage(message.id)}
          data-testid="assistant-retry"
        >
          <IconRefresh size={14} />
          重新执行
        </button>
      ) : null}
      {commandIsFinished(command) && command.steps.some((step) => step.capabilityId) ? (
        <button
          type="button"
          className="assistant-save-automation"
          onClick={() => saveAsAutomation(command)}
        >
          保存为自动化
          <IconChevronRight size={13} />
        </button>
      ) : null}
      <small className="assistant-trace">trace · {command.traceId}</small>
    </article>
  );
}

function BrowserCommandMessage({
  message
}: {
  message: Extract<AssistantMessage, { kind: 'browser' }>;
}): JSX.Element {
  const {
    busy,
    confirmBrowserCommand,
    cancelBrowserCommand
  } = useAssistant();
  const statusLabels = {
    awaiting_confirmation: '准备执行',
    running: '执行中',
    succeeded: '已完成',
    failed: '执行失败',
    cancelled: '已取消'
  };
  const canExecute = message.plan.status === 'failed';
  return (
    <article
      className="assistant-message assistant-message--browser"
      data-testid="assistant-browser-command"
    >
      <div className="assistant-message__author">
        <IconGlobe size={15} />
        <strong>浏览器助手</strong>
        <span className={`assistant-command__status status--${message.plan.status}`}>
          {statusLabels[message.plan.status]}
        </span>
      </div>
      <p>{message.plan.summary}</p>
      <section className="browser-command-plan">
        <h3>浏览器操作计划</h3>
        <ol>
          {message.plan.steps.map((step, index) => (
            <li
              key={step.stepId}
              className={`browser-command-step status--${step.status ?? 'pending'}`}
            >
              <span>{step.status === 'completed' ? '✓' : index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <small>
                  {step.action.type === 'click' || step.action.type === 'type'
                    ? '页面交互'
                    : '只读操作'}
                </small>
              </div>
              <em>
                {step.status === 'running'
                  ? '执行中'
                  : step.status === 'completed'
                    ? '完成'
                    : step.status === 'failed'
                      ? '失败'
                      : '等待'}
              </em>
            </li>
          ))}
        </ol>
      </section>
      {message.plan.error ? (
        <p className="browser-command__error">{message.plan.error}</p>
      ) : null}
      {message.plan.result ? (
        <section className="browser-command__result" data-testid="browser-command-result">
          <strong>执行结果</strong>
          <MarkdownContent className="assistant-answer">
            {message.plan.result}
          </MarkdownContent>
        </section>
      ) : null}
      {canExecute ? (
        <div className="command-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void cancelBrowserCommand(message.id)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void confirmBrowserCommand(message.id)}
            data-testid="confirm-browser-command"
          >
            <IconPlay size={14} />
            {message.plan.status === 'failed' ? '重新执行' : '确认并执行'}
          </button>
          <small>
            <IconShield size={12} /> 网页运行在隔离会话中，下载和权限请求默认阻止
          </small>
        </div>
      ) : null}
    </article>
  );
}

export function ErrorMessage({
  message
}: {
  message: Extract<AssistantMessage, { kind: 'error' }>;
}): JSX.Element {
  const { busy, retryMessage } = useAssistant();
  return (
    <article
      className="assistant-message assistant-message--error"
      data-testid="assistant-error"
    >
      <strong>暂时无法完成</strong>
      <p>{message.content}</p>
      {message.partialAnswer ? (
        <MarkdownContent className="assistant-answer">
          {message.partialAnswer}
        </MarkdownContent>
      ) : null}
      {message.request ? (
        <button
          type="button"
          className="assistant-retry"
          disabled={busy}
          onClick={() => void retryMessage(message.id)}
          data-testid="assistant-retry"
        >
          <IconRefresh size={14} />
          重新执行
        </button>
      ) : null}
    </article>
  );
}

function conversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function slashQuery(value: string, cursor: number): string | null {
  const beforeCursor = value.slice(0, cursor);
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(beforeCursor);
  return match ? match[1].toLocaleLowerCase() : null;
}

export function replaceSlashSkill(
  value: string,
  cursor: number,
  skillName: string
): { value: string; cursor: number } | null {
  const beforeCursor = value.slice(0, cursor);
  const afterCursor = value.slice(cursor);
  const match = /(?:^|\s)\/[^\s/]*$/.exec(beforeCursor);
  if (!match) return null;
  const prefix = beforeCursor.slice(0, match.index);
  const separator = prefix && !/\s$/.test(prefix) ? ' ' : '';
  const inserted = `/${skillName} `;
  // The typed query normally ends just before its existing separator. The
  // selected command owns that separator, avoiding a surprising double space.
  const remaining = afterCursor.replace(/^[ \t]/, '');
  return {
    value: `${prefix}${separator}${inserted}${remaining}`,
    cursor: prefix.length + separator.length + inserted.length
  };
}

export function AssistantPage({ home = false }: { home?: boolean }): JSX.Element {
  const {
    busy,
    canStop,
    messages,
    conversations,
    activeConversationId,
    selectConversation,
    attachments,
    pickAttachment,
    pasteImage,
    knowledgeBaseIds,
    setKnowledgeBaseIds,
    deepMode,
    setDeepMode,
    removeAttachment,
    submit,
    stopGeneration,
    clear,
    openFilesPanel,
    openArtifactPreview,
    openBrowserPanel
  } = useAssistant();
  const browser = useBrowserWorkspace();
  const [draft, setDraft] = React.useState('');
  const [conversationSearch, setConversationSearch] = React.useState('');
  const threadRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([]);
  const [promptSkills, setPromptSkills] = React.useState<PromptSkillSummary[]>([]);
  const [inputCursor, setInputCursor] = React.useState(0);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [slashDismissed, setSlashDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    workbenchApi
      .listPromptSkills()
      .then((items) => {
        if (!cancelled) setPromptSkills(items);
      })
      .catch(() => {
        // Skill 目录不可用不应影响普通对话；此时仅不展示斜杠菜单。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    workbenchApi
      .listKnowledgeBases()
      .then((items) => {
        if (!cancelled) setKnowledgeBases(items.filter((item) => item.enabled));
      })
      .catch(() => {
        // 知识库列表拉取失败时保持“自动路由”，不阻塞聊天。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSlashQuery = slashDismissed ? null : slashQuery(draft, inputCursor);
  const slashSkills = React.useMemo(() => {
    if (activeSlashQuery === null) return [];
    return promptSkills
      .filter((skill) => {
        const searchText = `${skill.name} ${skill.description}`.toLocaleLowerCase();
        return searchText.includes(activeSlashQuery);
      })
      .slice(0, 8);
  }, [activeSlashQuery, promptSkills]);
  // Keep the picker available while a previous response streams. The composer
  // already prevents submitting a second turn while busy, but users should be
  // able to prepare the next slash-command just like they can type normally.
  const slashMenuOpen = activeSlashQuery !== null && slashSkills.length > 0;

  React.useEffect(() => {
    setSlashIndex((current) => Math.min(current, Math.max(slashSkills.length - 1, 0)));
  }, [slashSkills.length]);

  function selectSlashSkill(skill: PromptSkillSummary): void {
    const cursor = inputRef.current?.selectionStart ?? inputCursor;
    const selection = replaceSlashSkill(draft, cursor, skill.name);
    if (!selection) return;
    setDraft(selection.value);
    setInputCursor(selection.cursor);
    setSlashDismissed(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(selection.cursor, selection.cursor);
    });
  }

  React.useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (busy) return;
      const image = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      if (!image) return;
      const file = image.getAsFile();
      if (!file) return;
      event.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return;
        void pasteImage({
          mimeType: file.type || 'image/png',
          contentBase64: dataUrl.slice(comma + 1),
          previewUrl: URL.createObjectURL(file)
        });
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [busy, pasteImage]);

  React.useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages, busy]);

  // 监听右上角 ToolsLauncher 触发的"自动填充 prompt"事件
  React.useEffect(() => {
    function handlePrefill(event: Event) {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail;
      if (typeof detail?.prompt === 'string') {
        setDraft(detail.prompt);
        inputRef.current?.focus();
      }
    }
    window.addEventListener('workbench:open-assistant', handlePrefill);
    return () => window.removeEventListener('workbench:open-assistant', handlePrefill);
  }, []);

  function send(): void {
    const message = draft.trim();
    if ((!message && attachments.length === 0) || busy) return;
    setDraft('');
    void submit(message);
  }

  const filteredConversations = conversations
    .map((conversation, index) => ({
      conversation,
      label: conversation.title || `历史会话 ${index + 1}`
    }))
    .filter(({ conversation, label }) => {
      const query = conversationSearch.trim().toLowerCase();
      return (
        label.toLowerCase().includes(query) ||
        conversation.conversationId.toLowerCase().includes(query)
      );
    })
    .slice(0, 5);

  const docPreview = useDocumentPreview();
  const hasDocPreview = docPreview.visible;
  const hasBrowser = browser.state.visible;

  const workspace = (
    <div
      className={`assistant-workspace ${hasBrowser ? 'has-browser' : ''} ${
        hasDocPreview ? 'has-doc-preview' : ''
      }`}
      data-testid="assistant-workspace"
    >
      <section
        className="assistant-page"
        aria-label="AI 工作助手"
        data-testid="assistant-page"
      >
        <header className="assistant-page__header">
          <div className="assistant-conversation-search">
            <IconSearch size={14} />
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="搜索会话或任务…"
              aria-label="搜索会话或任务"
            />
            <kbd>⌘ K</kbd>
          </div>
          <button
            type="button"
            className="btn btn--sm assistant-new-conversation"
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
          >
            新建
          </button>
        </header>
        <nav className="assistant-conversation-tabs" aria-label="最近会话">
          {filteredConversations.map(({ conversation, label }) => (
            <button
              type="button"
              className={conversation.conversationId === activeConversationId ? 'is-active' : ''}
              onClick={() => void selectConversation(conversation.conversationId, conversation)}
              key={conversation.conversationId}
            >
              <strong>{label}</strong>
              <small>{conversationTime(conversation.updatedAt)}</small>
            </button>
          ))}
          {filteredConversations.length === 0 ? (
            <span>当前没有匹配的历史会话</span>
          ) : null}
        </nav>
        <div className="assistant-thread" ref={threadRef}>
          <div className="assistant-thread__content">
            {messages.length === 0 ? (
              <div className="assistant-welcome">
                <IconSparkles size={24} />
                <h2>今天想完成什么？</h2>
                <p>描述目标即可。助手会读取上下文、调用所需能力并持续检查结果，直到真正完成或需要你介入。</p>
                <div className="assistant-welcome__prompts">
                  {[
                    '查询天气等日常问答，例如"今天北京天气怎么样"',
                    '上传 Excel/资料生成幻灯片，例如"分析这份销售数据并生成汇报演示文稿"',
                    '导入知识库文件进行检索，例如"根据产品手册回答售后问题"'
                  ].map((hint) => (
                    <div className="assistant-welcome__hint" key={hint}>
                      {hint}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => {
              if (message.kind === 'text') {
                return (
                  <article className="assistant-message assistant-message--user" key={message.id}>
                    <span>你</span>
                    <p>{message.content}</p>
                    {message.attachments && message.attachments.length > 0 ? (
                      <div className="assistant-attachments">
                        {message.attachments.map((attachment) => (
                          <span key={attachment.artifactId}>
                            <IconFile size={13} />
                            {attachment.displayName}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              }
              if (message.kind === 'answer') {
                return <AnswerMessage key={message.id} message={message} />;
              }
              if (message.kind === 'command') {
                return <CommandMessage key={message.id} message={message} />;
              }
              if (message.kind === 'browser') {
                return <BrowserCommandMessage key={message.id} message={message} />;
              }
              return <ErrorMessage key={message.id} message={message} />;
            })}
            {busy && !messages.some(
              (message) => message.kind === 'answer' && message.streaming
            ) ? (
              <div className="assistant-thinking" data-testid="assistant-thinking">
                <span className="spinner" />
                正在理解目标并读取业务上下文…
              </div>
            ) : null}
          </div>
        </div>
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {attachments.length > 0 ? (
            <div className="assistant-attachments">
              {attachments.map((attachment) => (
                <span key={attachment.artifactId}>
                  {attachment.mimeType?.startsWith('image/') && attachment.previewUrl ? (
                    <img src={attachment.previewUrl} alt={attachment.displayName} className="assistant-attachment-thumb" />
                  ) : <IconFile size={13} />}
                  {attachment.displayName}
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.artifactId)}
                    aria-label={`移除 ${attachment.displayName}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setInputCursor(event.target.selectionStart);
              setSlashDismissed(false);
            }}
            onClick={(event) => {
              setInputCursor(event.currentTarget.selectionStart);
              setSlashDismissed(false);
            }}
            onKeyUp={(event) => setInputCursor(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (slashMenuOpen) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSlashIndex((current) => (current + 1) % slashSkills.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSlashIndex((current) => (current - 1 + slashSkills.length) % slashSkills.length);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSlashDismissed(true);
                  return;
                }
                if (event.key === 'Tab' || event.key === 'Enter') {
                  if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                    event.preventDefault();
                    selectSlashSkill(slashSkills[slashIndex]);
                    return;
                  }
                }
              }
              // 输入法组合态（拼音/英文候选）下按 Enter 是确认候选词，
              // 不是发送；keyCode 229 兜底某些 IME 提交时 isComposing 已为 false 的情况
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="继续追问，或描述要完成的工作…"
            aria-label="向 AI 工作助手输入内容"
            data-testid={home ? 'home-assistant-input' : 'assistant-input'}
          />
          {slashMenuOpen ? (
            <div
              className="assistant-skill-menu"
              role="listbox"
              aria-label="选择 Skill"
              data-testid="assistant-skill-menu"
            >
              <div className="assistant-skill-menu__header">
                <span>Skills</span>
                <small>↑↓ 选择 · Enter 确认</small>
              </div>
              {slashSkills.map((skill, index) => (
                <button
                  key={skill.name}
                  type="button"
                  role="option"
                  aria-selected={index === slashIndex}
                  className={index === slashIndex ? 'is-active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSlashSkill(skill)}
                >
                  <strong>/{skill.name}</strong>
                  <span>{skill.description}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="assistant-composer__toolbar">
            <button
              type="button"
              className="assistant-attach"
              onClick={() => void pickAttachment()}
              disabled={busy}
              aria-label="选择文件"
              title="选择工作文件（Excel/CSV/Word/PDF/PPT/文本）或 Skill / CLI 源码包（zip）"
            >
              <IconPaperclip size={16} />
            </button>
            <select
              className="assistant-knowledge-select"
              value={knowledgeBaseIds[0] ?? ''}
              onChange={(event) =>
                setKnowledgeBaseIds(event.target.value ? [event.target.value] : [])
              }
              disabled={busy}
              aria-label="选择知识库"
              title="限定本会话检索的知识库，默认自动路由"
              data-testid="assistant-knowledge-base-select"
            >
              <option value="">自动路由</option>
              {knowledgeBases.map((base) => (
                <option
                  key={base.knowledgeBaseId}
                  value={base.knowledgeBaseId}
                  title={base.description || undefined}
                >
                  {base.name}{base.domain ? ` · ${base.domain}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={'assistant-deep-toggle' + (deepMode ? ' assistant-deep-toggle--active' : '')}
              onClick={() => setDeepMode(!deepMode)}
              disabled={busy}
              aria-label={deepMode ? '关闭深度研究' : '开启深度研究'}
              title={deepMode ? '深度研究已开启：将对回答进行多轮自检（更慢、更准）' : '开启深度研究：先规划子问题、再检索、再反思，最后综合（默认关闭）'}
              data-testid="assistant-deep-toggle"
            >
              {deepMode ? '深度研究·开' : '深度研究·关'}
            </button>
            {canStop ? (
              <button
                type="button"
                className="btn btn--danger assistant-stop"
                onClick={stopGeneration}
                aria-label="停止生成"
                title="停止当前任务"
                data-testid="assistant-stop"
              >
                <IconStop size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || (!draft.trim() && attachments.length === 0)}
                aria-label="发送"
                data-testid="assistant-send"
              >
                <IconSend size={15} />
              </button>
            )}
          </div>
        </form>
      </section>
      <BrowserPanel
        onOpenFiles={openFilesPanel}
        onOpenBrowser={openBrowserPanel}
      />
      <DocumentPreviewPanel
        onOpenArtifact={openArtifactPreview}
        onOpenFiles={openFilesPanel}
        onOpenBrowser={openBrowserPanel}
      />
    </div>
  );

  return home ? (
    <div className="assistant-home-route" data-testid="home-page">
      {workspace}
    </div>
  ) : workspace;
}

function DeepResearchTracePanel({ trace }: { trace: DeepResearchTrace }) {
  return (
    <details className="assistant-deep-trace" data-testid="assistant-deep-trace">
      <summary>
        深度研究进度（{trace.coveredIds.length}/{trace.subQuestions.length} 子问题，迭代 {trace.iterations} 次，置信度 {(trace.confidence * 100).toFixed(0)}%）
      </summary>
      <ol className="assistant-deep-trace__list">
        {trace.subQuestions.map((sq) => {
          const done = trace.coveredIds.includes(sq.id);
          return (
            <li key={sq.id} className={'assistant-deep-trace__item' + (done ? ' is-covered' : ' is-pending')}>
              <span className="assistant-deep-trace__id">[{sq.id}]</span>
              <span className="assistant-deep-trace__intent">{sq.intent}</span>
              <span className="assistant-deep-trace__question">{sq.question}</span>
            </li>
          );
        })}
      </ol>
      {trace.missingTopics.length > 0 ? (
        <div className="assistant-deep-trace__missing">
          <strong>仍需研究：</strong>
          <ul>
            {trace.missingTopics.map((topic, idx) => (
              <li key={idx}>{topic}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {trace.reflectionRationale ? (
        <p className="assistant-deep-trace__rationale">{trace.reflectionRationale}</p>
      ) : null}
    </details>
  );
}
