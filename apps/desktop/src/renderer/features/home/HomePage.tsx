import React from 'react';
import { Link } from 'react-router-dom';
import {
  TelesalesWorkspaceSchema,
  type Anomaly,
  type TelesalesWorkspace
} from '../../../shared/contracts';
import {
  IconAlert,
  IconApproval,
  IconArrowRight,
  IconBook,
  IconChevronRight,
  IconClock,
  IconExternal,
  IconPhone,
  IconPlay,
  IconRefresh,
  IconRobot,
  IconSend,
  IconShield,
  IconSparkles,
  IconTask
} from '../../components/icons';
import { workbenchApi } from '../../api';
import { useAssistant } from '../assistant/AssistantContext';

const PLAN_DATE = new Date().toISOString().slice(0, 10);
const FLOW_STAGES = ['目标', '计划', '审批', '执行', '验证', '完成'] as const;

type FlowAction = {
  key: string;
  label: string;
  description: string;
  run?: () => Promise<void>;
  to?: string;
};

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const value = body as { detail?: string; error?: { message?: string } };
  return value.error?.message ?? value.detail ?? fallback;
}

function flowStage(workspace: TelesalesWorkspace | null): number {
  if (!workspace) return 0;
  const campaign = workspace.campaigns[0];
  if (!workspace.plan && !campaign) return 0;
  if (!campaign) return workspace.plan ? 2 : 0;
  if (campaign.status === 'pending_approval') return 2;
  if (campaign.status === 'approved' || campaign.status === 'queued') return 3;
  if (campaign.status === 'completed') {
    if (workspace.followups.some((item) => item.status !== 'completed')) return 4;
    return workspace.qualitySummary.totalInspections > 0 ||
      workspace.followups.some((item) => item.status === 'completed')
      ? 5
      : 4;
  }
  return workspace.qualitySummary.totalInspections > 0 ? 4 : 2;
}

function stageStatus(index: number, current: number): 'complete' | 'current' | 'pending' {
  if (index < current || current === FLOW_STAGES.length - 1) return 'complete';
  if (index === current) return 'current';
  return 'pending';
}

function campaignStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    pending_approval: '审批中',
    approved: '待执行',
    queued: '执行中',
    completed: '验证中',
    failed: '需要处理'
  };
  return status ? labels[status] ?? status : '准备中';
}

export function HomePage(): JSX.Element {
  const { openAssistant } = useAssistant();
  const [draft, setDraft] = React.useState('');
  const [workspace, setWorkspace] = React.useState<TelesalesWorkspace | null>(null);
  const [anomalies, setAnomalies] = React.useState<Anomaly[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    const [workspaceResult, anomalyResult] = await Promise.allSettled([
      workbenchApi.request({
        method: 'GET',
        path: `/api/telesales/workspace?plan_date=${PLAN_DATE}`
      }),
      workbenchApi.listAnomalies()
    ]);
    if (workspaceResult.status === 'rejected') throw workspaceResult.reason;
    if (workspaceResult.value.status >= 400 || workspaceResult.value.status === 0) {
      throw new Error(
        responseError(workspaceResult.value.body, '业务流程加载失败')
      );
    }
    setWorkspace(TelesalesWorkspaceSchema.parse(workspaceResult.value.body));
    if (anomalyResult.status === 'fulfilled') {
      setAnomalies(
        anomalyResult.value.items.filter(
          (item) => !['resolved', 'ignored'].includes(item.status)
        )
      );
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void refresh()
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const runAction = React.useCallback(
    async (
      key: string,
      request: Parameters<typeof workbenchApi.request>[0],
      successMessage: string
    ) => {
      setBusyKey(key);
      setNotice(null);
      setError(null);
      try {
        const response = await workbenchApi.request(request);
        if (response.status >= 400 || response.status === 0) {
          throw new Error(responseError(response.body, '操作失败'));
        }
        setNotice(successMessage);
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusyKey(null);
      }
    },
    [refresh]
  );

  const campaign = workspace?.campaigns[0];
  const firstMerchant = workspace?.merchants[0];
  const pendingFollowup = workspace?.followups.find(
    (item) => item.status !== 'completed'
  );
  const openAnomaly = anomalies[0];
  const currentStage = flowStage(workspace);

  const bootstrap = React.useCallback(
    () =>
      runAction(
        'bootstrap',
        {
          method: 'POST',
          path: '/api/telesales/pilot/bootstrap',
          body: { plan_date: PLAN_DATE },
          idempotencyKey: `telesales-pilot:${PLAN_DATE}`
        },
        '今日客群、执行计划和审批链已准备完成'
      ),
    [runAction]
  );

  const primaryAction: FlowAction = React.useMemo(() => {
    if (!workspace?.plan && !campaign) {
      return {
        key: 'bootstrap',
        label: '启动完整业务流程',
        description: '载入脱敏试点数据并生成今日执行计划',
        run: bootstrap
      };
    }
    if (campaign?.status === 'pending_approval') {
      return {
        key: `campaign:${campaign.campaignId}`,
        label: '批准并继续',
        description: '冻结客群、话术、静默时段与退订名单后继续',
        run: () =>
          runAction(
            `campaign:${campaign.campaignId}`,
            {
              method: 'POST',
              path: `/api/outbound-campaigns/${encodeURIComponent(
                campaign.campaignId
              )}/approve`,
              body: {
                expected_version: campaign.version,
                reason: '工作流已核验客群、话术、静默时段与退订名单'
              },
              expectedVersion: campaign.version,
              idempotencyKey: `campaign-approve:${campaign.campaignId}:${campaign.version}`
            },
            '活动已批准，执行参数已冻结'
          )
      };
    }
    if (campaign?.status === 'approved') {
      return {
        key: `campaign:${campaign.campaignId}`,
        label: '提交执行',
        description: '通过事务型 Outbox 交给独立 Worker 执行',
        run: () =>
          runAction(
            `campaign:${campaign.campaignId}`,
            {
              method: 'POST',
              path: `/api/outbound-campaigns/${encodeURIComponent(
                campaign.campaignId
              )}/start`,
              body: { expected_version: campaign.version },
              expectedVersion: campaign.version,
              idempotencyKey: `campaign-start:${campaign.campaignId}:${campaign.version}`
            },
            '活动已进入执行队列'
          )
      };
    }
    if (pendingFollowup) {
      return {
        key: `followup:${pendingFollowup.followupId}`,
        label: '完成客户跟进',
        description: pendingFollowup.recommendedAction,
        run: () =>
          runAction(
            `followup:${pendingFollowup.followupId}`,
            {
              method: 'POST',
              path: `/api/telesales/followups/${encodeURIComponent(
                pendingFollowup.followupId
              )}/complete`,
              idempotencyKey: `followup-complete:${pendingFollowup.followupId}`
            },
            '人工跟进已完成，结果已回写'
          )
      };
    }
    if (
      firstMerchant &&
      (campaign?.status === 'queued' ||
        (campaign?.status === 'completed' &&
          workspace.qualitySummary.totalInspections === 0 &&
          workspace.followups.length === 0))
    ) {
      return {
        key: `call:${firstMerchant.merchantId}`,
        label: '运行一通试点外呼',
        description: '运行离线连接器并生成意向、质检与跟进结果',
        run: () =>
          runAction(
            `call:${firstMerchant.merchantId}`,
            {
              method: 'POST',
              path: `/api/telesales/merchants/${encodeURIComponent(
                firstMerchant.merchantId
              )}/simulate-call`,
              body: {
                scenario: 'successful',
                plan_id: workspace.plan?.planId ?? null
              },
              idempotencyKey: `telesales-call:${firstMerchant.merchantId}:${Date.now()}`
            },
            '试点外呼已完成，意向、质检和跟进已回写'
          )
      };
    }
    if (currentStage === FLOW_STAGES.length - 1) {
      return {
        key: 'completed',
        label: '查看完成结果',
        description: '查看执行记录、人工回写和验证证据',
        to: '/history'
      };
    }
    if (openAnomaly) {
      return {
        key: 'anomaly',
        label: '处理执行异常',
        description: openAnomaly.title,
        to: `/anomalies/${encodeURIComponent(openAnomaly.anomalyId)}`
      };
    }
    return {
      key: 'assistant',
      label: '让 AI 继续推进',
      description: '基于当前任务上下文生成下一步建议',
      run: async () => {
        openAssistant('继续推进“跟进今日高意向客户”任务，并告诉我下一步需要做什么', {
          page: 'workflow',
          label: '高意向客户跟进'
        });
      }
    };
  }, [
    bootstrap,
    campaign,
    currentStage,
    firstMerchant,
    openAnomaly,
    openAssistant,
    pendingFollowup,
    runAction,
    workspace
  ]);

  function send(message = draft): void {
    const value = message.trim();
    if (!value) return;
    setDraft('');
    openAssistant(value, {
      page: 'workflow',
      label: '跟进今日高意向客户',
      objectType: campaign ? 'campaign' : undefined,
      objectId: campaign?.campaignId
    });
  }

  const completedPrechecks =
    campaign?.precheck.filter((item) => item.passed).length ?? 0;
  const totalPrechecks = campaign?.precheck.length ?? 0;
  const completedFollowups =
    workspace?.followups.filter((item) => item.status === 'completed').length ?? 0;
  const pendingFollowups =
    (workspace?.followups.length ?? 0) - completedFollowups;

  return (
    <section className="flow-page home-page" data-testid="home-page">
      <div className="flow-main">
        <header className="flow-header">
          <div>
            <span className="flow-header__label">当前业务任务</span>
            <h2>跟进今日高意向客户</h2>
            <p>
              识别高意向客户，完成受控触达、人工跟进与质量验证。
            </p>
          </div>
          <dl className="flow-header__meta">
            <div>
              <dt>负责人</dt>
              <dd>销售主管</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>
                {currentStage === FLOW_STAGES.length - 1
                  ? '已完成'
                  : campaignStatusLabel(campaign?.status)}
              </dd>
            </div>
          </dl>
        </header>

        <ol className="flow-stages" aria-label="任务阶段" data-testid="flow-stages">
          {FLOW_STAGES.map((stage, index) => {
            const status = stageStatus(index, currentStage);
            return (
              <li className={`is-${status}`} key={stage}>
                <span>{status === 'complete' ? '✓' : index + 1}</span>
                <strong>{stage}</strong>
              </li>
            );
          })}
        </ol>

        {loading ? (
          <p className="flow-loading">
            <span className="spinner" />
            正在汇总任务、审批、执行与验证状态…
          </p>
        ) : null}
        {error ? (
          <div className="flow-notice flow-notice--error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--sm" onClick={() => void refresh()}>
              <IconRefresh size={13} />
              重新加载
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="flow-notice flow-notice--ok" role="status">
            {notice}
          </div>
        ) : null}

        <div className="flow-timeline" data-testid="flow-timeline">
          <article className="flow-event is-complete">
            <span className="flow-event__icon"><IconTask size={15} /></span>
            <div>
              <header><strong>你 · 发起目标</strong><time>开始</time></header>
              <p>跟进今天的高意向客户，并持续记录执行和验证结果。</p>
            </div>
          </article>

          <article className={`flow-event ${workspace?.plan || campaign ? 'is-complete' : 'is-current'}`}>
            <span className="flow-event__icon"><IconSparkles size={15} /></span>
            <div>
              <header><strong>AI · 制定计划</strong><time>计划</time></header>
              {workspace?.plan ? (
                <p>
                  已生成今日计划：目标触达 {workspace.plan.targetOutboundCalls} 位客户，
                  AI 执行 {workspace.plan.aiCallsAllocated} 通，人工接续{' '}
                  {workspace.plan.humanCallsAllocated} 通。
                </p>
              ) : campaign ? (
                <p>
                  已恢复执行计划“{campaign.name}”：目标触达 {campaign.audienceCount} 位客户，
                  当前状态为
                  {currentStage === FLOW_STAGES.length - 1
                    ? '已完成'
                    : campaignStatusLabel(campaign.status)}
                  。
                </p>
              ) : (
                <p>尚未生成今日计划。启动流程后会载入脱敏客群并完成执行前检查。</p>
              )}
            </div>
          </article>

          <article className={`flow-event ${workspace?.plan || campaign ? 'is-complete' : ''}`}>
            <span className="flow-event__icon"><IconPlay size={15} /></span>
            <div>
              <header><strong>系统 · 执行前分析</strong><time>只读</time></header>
              <p>
                已识别 {campaign?.audienceCount ?? workspace?.merchants.length ?? 0} 位目标客户，
                排除 {campaign?.excludedCount ?? 0} 位不适合触达的客户；
                {completedPrechecks}/{totalPrechecks || 0} 项治理检查通过。
              </p>
              <Link to="/telesales">查看业务对象和完整计划 <IconChevronRight size={12} /></Link>
            </div>
          </article>

          <article
            className={`flow-event flow-event--approval ${
              campaign?.status === 'pending_approval' ? 'is-current' : campaign ? 'is-complete' : ''
            }`}
          >
            <span className="flow-event__icon"><IconApproval size={15} /></span>
            <div>
              <header>
                <strong>
                  {campaign?.status === 'pending_approval'
                    ? '需要你的审批'
                    : '审批与执行授权'}
                </strong>
                <time>
                  {campaign?.status === 'pending_approval'
                    ? '待审批'
                    : campaign
                      ? '已批准'
                      : '准备中'}
                </time>
              </header>
              <p>
                {campaign?.status === 'pending_approval'
                  ? `外部触达前需要核验 ${campaign.audienceCount} 位客户、话术 ${campaign.scriptVersion} 和 ${campaign.scheduleWindow} 执行窗口。`
                  : campaign
                    ? '审批已完成，受控写操作可以继续。'
                    : '计划生成后，需要主管审批外部触达动作。'}
              </p>
            </div>
          </article>

          {openAnomaly || (workspace?.qualitySummary.highRiskCount ?? 0) > 0 ? (
            <article className="flow-event flow-event--error">
              <span className="flow-event__icon"><IconAlert size={15} /></span>
              <div>
                <header><strong>异常（可恢复）</strong><time>需要处理</time></header>
                <p>
                  {openAnomaly?.title ??
                    `质检发现 ${workspace?.qualitySummary.highRiskCount ?? 0} 条高风险记录，已进入异常队列。`}
                </p>
                <Link to={openAnomaly ? `/anomalies/${openAnomaly.anomalyId}` : '/anomalies'}>
                  查看异常详情 <IconChevronRight size={12} />
                </Link>
              </div>
            </article>
          ) : null}

          <article
            className={`flow-event ${
              (workspace?.qualitySummary.totalInspections ?? 0) > 0
                || completedFollowups > 0
                ? 'is-complete'
                : ''
            }`}
          >
            <span className="flow-event__icon"><IconShield size={15} /></span>
            <div>
              <header><strong>验证预览</strong><time>持续更新</time></header>
              <p>
                已触达 {workspace?.conversionFunnel.called ?? 0} 位客户，识别高意向{' '}
                {workspace?.conversionFunnel.intent ?? 0} 位；质检{' '}
                {workspace?.qualitySummary.totalInspections ?? 0} 条，平均合规分{' '}
                {Math.round(workspace?.qualitySummary.avgComplianceScore ?? 0)}。
                {pendingFollowups > 0
                  ? ` 还有 ${pendingFollowups} 项人工跟进待完成。`
                  : completedFollowups > 0
                    ? ` 已完成 ${completedFollowups} 项人工跟进并回写结果。`
                    : ''}
              </p>
              <Link to="/history">查看完整执行记录与证据 <IconExternal size={12} /></Link>
            </div>
          </article>
        </div>

        <form
          className="flow-composer home-composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
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
            placeholder="继续追问或调整任务…"
            aria-label="问问题或描述工作"
            data-testid="home-assistant-input"
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!draft.trim()}
            aria-label="发送给 AI 工作助手"
          >
            <IconSend size={16} />
          </button>
        </form>
      </div>

      <aside className="flow-context" aria-label="任务上下文">
        <section>
          <header><IconTask size={15} /><strong>任务摘要</strong></header>
          <p>
            从今日客群中识别高意向客户，执行受控触达，自动沉淀质检证据，并把人工跟进结果回写。
          </p>
        </section>
        <section>
          <header><IconPhone size={15} /><strong>业务对象</strong></header>
          <dl>
            <div><dt>目标客户</dt><dd>{campaign?.audienceCount ?? workspace?.merchants.length ?? 0} 位</dd></div>
            <div><dt>已触达</dt><dd>{workspace?.conversionFunnel.called ?? 0} 位</dd></div>
            <div><dt>高意向</dt><dd>{workspace?.conversionFunnel.intent ?? 0} 位</dd></div>
            <div><dt>待跟进</dt><dd>{pendingFollowups} 项</dd></div>
          </dl>
          <Link to="/telesales">查看对象列表 <IconChevronRight size={12} /></Link>
        </section>
        <section>
          <header><IconBook size={15} /><strong>执行依据</strong></header>
          <ul>
            {(campaign?.precheck ?? []).slice(0, 4).map((check) => (
              <li key={check.key}>
                <span className={check.passed ? 'is-ok' : 'is-error'} />
                {check.label}
              </li>
            ))}
            {(campaign?.precheck.length ?? 0) === 0 ? (
              <>
                <li><span className="is-ok" />高意向客户识别规则</li>
                <li><span className="is-ok" />销售跟进 SOP</li>
                <li><span className="is-ok" />静默时段与退订策略</li>
              </>
            ) : null}
          </ul>
          <Link to="/knowledge">查看全部依据 <IconChevronRight size={12} /></Link>
        </section>
        <section className="flow-context__action">
          <header><IconRobot size={15} /><strong>当前操作</strong></header>
          {primaryAction.to ? (
            <Link
              className="btn btn--primary flow-primary-action"
              to={primaryAction.to}
              data-testid="flow-primary-action"
            >
              {primaryAction.label}
              <IconArrowRight size={14} />
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn--primary flow-primary-action"
              data-testid="flow-primary-action"
              disabled={busyKey === primaryAction.key}
              onClick={() => void primaryAction.run?.()}
            >
              {busyKey === primaryAction.key ? '正在处理…' : primaryAction.label}
              <IconArrowRight size={14} />
            </button>
          )}
          <small>{primaryAction.description}</small>
        </section>
        <nav className="flow-context__links" aria-label="相关功能">
          <Link to="/tasks"><IconTask size={13} />任务</Link>
          <Link to="/approvals"><IconApproval size={13} />审批</Link>
          <Link to="/anomalies"><IconAlert size={13} />异常</Link>
          <Link to="/history"><IconClock size={13} />历史</Link>
        </nav>
      </aside>
    </section>
  );
}
