import React from 'react';
import { Link } from 'react-router-dom';
import {
  TelesalesWorkspaceSchema,
  type TelesalesWorkspace
} from '../../../shared/contracts';
import { IconPhone, IconRefresh } from '../../components/icons';

const PLAN_DATE = new Date().toISOString().slice(0, 10);

const STAGE_LABELS: Record<string, string> = {
  unassigned: '待分配',
  assigned: '待触达',
  contacted: '已触达',
  interested: '高意向',
  follow_up: '跟进中',
  do_not_call: '禁止外呼',
  risk_hold: '风险暂停'
};

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  pending_approval: '待审批',
  approved: '已批准',
  queued: 'Outbox 排队中',
  completed: '已完成',
  failed: '执行失败'
};

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const data = body as { error?: { message?: string }; detail?: string };
  return data.error?.message ?? data.detail ?? fallback;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function TelesalesPage(): JSX.Element {
  const [workspace, setWorkspace] = React.useState<TelesalesWorkspace | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    const response = await window.workbenchApi.request({
      method: 'GET',
      path: `/api/telesales/workspace?plan_date=${PLAN_DATE}`
    });
    if (response.status >= 400 || response.status === 0) {
      throw new Error(errorMessage(response.body, '电话销售工作区加载失败'));
    }
    setWorkspace(TelesalesWorkspaceSchema.parse(response.body));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const runAction = React.useCallback(
    async (
      key: string,
      request: Parameters<typeof window.workbenchApi.request>[0],
      successMessage: string
    ) => {
      setBusyKey(key);
      setError(null);
      setNotice(null);
      try {
        const response = await window.workbenchApi.request(request);
        if (response.status >= 400 || response.status === 0) {
          throw new Error(errorMessage(response.body, '操作失败'));
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

  const bootstrap = () =>
    runAction(
      'bootstrap',
      {
        method: 'POST',
        path: '/api/telesales/pilot/bootstrap',
        body: { plan_date: PLAN_DATE },
        idempotencyKey: `telesales-pilot:${PLAN_DATE}`
      },
      '试点客群与今日计划已就绪'
    );

  const simulateCall = (merchantId: string, scenario: 'successful' | 'compliance_risk') =>
    runAction(
      `call:${merchantId}:${scenario}`,
      {
        method: 'POST',
        path: `/api/telesales/merchants/${encodeURIComponent(merchantId)}/simulate-call`,
        body: {
          scenario,
          plan_id: workspace?.plan?.planId ?? null
        },
        idempotencyKey: `telesales-call:${merchantId}:${scenario}:${Date.now()}`
      },
      scenario === 'successful'
        ? '模拟通话已完成，意向、质检和跟进已回写'
        : '已生成合规风险通话，并自动进入异常队列'
    );

  const campaignAction = (campaign: TelesalesWorkspace['campaigns'][number]) => {
    if (campaign.status === 'pending_approval') {
      return runAction(
        `campaign:${campaign.campaignId}`,
        {
          method: 'POST',
          path: `/api/outbound-campaigns/${encodeURIComponent(campaign.campaignId)}/approve`,
          body: {
            expected_version: campaign.version,
            reason: '电话销售工作台已核验客群、话术、静默时段与退订名单'
          },
          expectedVersion: campaign.version,
          idempotencyKey: `campaign-approve:${campaign.campaignId}:${campaign.version}`
        },
        '外呼活动已批准，执行参数已冻结'
      );
    }
    return runAction(
      `campaign:${campaign.campaignId}`,
      {
        method: 'POST',
        path: `/api/outbound-campaigns/${encodeURIComponent(campaign.campaignId)}/start`,
        body: { expected_version: campaign.version },
        expectedVersion: campaign.version,
        idempotencyKey: `campaign-start:${campaign.campaignId}:${campaign.version}`
      },
      '外呼活动已提交；Outbox 模式下会由独立 Worker 执行'
    );
  };

  if (loading) {
    return (
      <section className="page telesales" data-testid="telesales-page">
        <p className="status-line">
          <span className="spinner" />
          正在加载电话销售工作区…
        </p>
      </section>
    );
  }

  return (
    <section className="page telesales" data-testid="telesales-page">
      <header className="page__header">
        <div>
          <h2>电话销售试点</h2>
          <p>从批量活动审批到 AI 外呼、意向识别、人工跟进、质检和异常处置。</p>
        </div>
        <div className="telesales__header-actions">
          <span className="badge badge--neutral">{PLAN_DATE}</span>
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => void refresh().catch((reason) => setError(String(reason)))}
          >
            <IconRefresh size={14} />
            刷新
          </button>
        </div>
      </header>

      {error ? (
        <div className="telesales__message telesales__message--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="telesales__message telesales__message--ok" role="status">
          {notice}
        </div>
      ) : null}

      {!workspace?.plan ? (
        <div className="telesales__onboarding panel">
          <span className="telesales__hero-icon">
            <IconPhone size={22} />
          </span>
          <div>
            <h3>载入电话销售 MVP</h3>
            <p className="muted">
              创建 3 个脱敏试点商户和今日 OPDCA 计划，不会拨打真实电话。
            </p>
          </div>
          <button
            className="btn btn--primary"
            data-testid="telesales-bootstrap"
            disabled={busyKey === 'bootstrap'}
            onClick={() => void bootstrap()}
            type="button"
          >
            {busyKey === 'bootstrap' ? '正在初始化…' : '载入试点'}
          </button>
        </div>
      ) : null}

      <div className="telesales__kpis" aria-label="电话销售关键指标">
        <article>
          <span>今日拨打</span>
          <strong>{workspace?.conversionFunnel.called ?? 0}</strong>
          <small>
            目标 {workspace?.plan?.targetOutboundCalls ?? 0} ·{' '}
            {percent(workspace?.callTargetCompletion ?? 0)}
          </small>
        </article>
        <article>
          <span>有效接通</span>
          <strong>{workspace?.conversionFunnel.connected ?? 0}</strong>
          <small>AI {workspace?.conversionFunnel.aiCalls ?? 0} 通</small>
        </article>
        <article>
          <span>高意向</span>
          <strong>{workspace?.conversionFunnel.intent ?? 0}</strong>
          <small>待人工跟进 {workspace?.conversionFunnel.followup ?? 0}</small>
        </article>
        <article className={(workspace?.qualitySummary.highRiskCount ?? 0) > 0 ? 'is-risk' : ''}>
          <span>合规质检</span>
          <strong>{Math.round(workspace?.qualitySummary.avgComplianceScore ?? 0)}</strong>
          <small>高风险 {workspace?.qualitySummary.highRiskCount ?? 0} 条</small>
        </article>
      </div>

      <div className="telesales__grid">
        <section className="panel telesales__campaigns">
          <header className="telesales__section-header">
            <div>
              <h3>批量外呼治理</h3>
              <p>审批、冻结版本，再通过事务型 Outbox 执行外部触达。</p>
            </div>
            <span className="badge badge--awaiting_approval">
              待审批 {workspace?.governance.pendingApprovals ?? 0}
            </span>
          </header>
          {(workspace?.campaigns ?? []).map((campaign) => {
            const canAct =
              campaign.status === 'pending_approval' || campaign.status === 'approved';
            return (
              <article className="telesales__campaign" key={campaign.campaignId}>
                <div>
                  <strong>{campaign.name}</strong>
                  <span className={`badge badge--${campaign.status}`}>
                    {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                  </span>
                </div>
                <p>
                  客群 {campaign.audienceCount} · 排除 {campaign.excludedCount} ·{' '}
                  {campaign.scheduleWindow} · 话术 {campaign.scriptVersion}
                </p>
                <ul className="telesales__checks">
                  {campaign.precheck.map((check) => (
                    <li key={check.key} className={check.passed ? 'ok' : 'err'}>
                      {check.passed ? '✓' : '×'} {check.label}
                    </li>
                  ))}
                </ul>
                {canAct ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busyKey === `campaign:${campaign.campaignId}`}
                    onClick={() => void campaignAction(campaign)}
                  >
                    {campaign.status === 'pending_approval' ? '审批活动' : '提交执行'}
                  </button>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="panel telesales__inspections">
          <header className="telesales__section-header">
            <div>
              <h3>AI 质检</h3>
              <p>每通电话完成后自动评分，高风险直接进入异常队列。</p>
            </div>
            <Link to="/anomalies">查看异常</Link>
          </header>
          {(workspace?.inspections.length ?? 0) === 0 ? (
            <p className="muted">完成一通模拟外呼后，这里会显示质检证据。</p>
          ) : (
            <ol className="telesales__inspection-list">
              {workspace?.inspections.slice(0, 5).map((inspection) => (
                <li key={inspection.inspectionId}>
                  <span className={`risk-dot risk-dot--${inspection.riskLevel.toLowerCase()}`} />
                  <div>
                    <strong>{inspection.riskLevel} · 合规 {inspection.complianceScore}</strong>
                    <small>
                      销售质量 {inspection.salesQualityScore} · 命中{' '}
                      {inspection.violations.length} 条规则
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="panel">
        <header className="telesales__section-header">
          <div>
            <h3>坐席任务与客户画像</h3>
            <p>试点按钮只运行离线模拟连接器；真实外呼必须走上方审批链。</p>
          </div>
        </header>
        {(workspace?.merchants.length ?? 0) === 0 ? (
          <p className="muted">尚未载入试点商户。</p>
        ) : (
          <div className="table-wrap">
            <table className="table telesales__table">
              <thead>
                <tr>
                  <th>商户</th>
                  <th>分层</th>
                  <th>负责人</th>
                  <th>阶段</th>
                  <th>试点动作</th>
                </tr>
              </thead>
              <tbody>
                {workspace?.merchants.map((merchant) => (
                  <tr key={merchant.merchantId}>
                    <td>
                      <strong>{merchant.name}</strong>
                      <small>{merchant.region} · {merchant.phone}</small>
                    </td>
                    <td>{merchant.tier} · {merchant.category}</td>
                    <td>{merchant.assignedSalespersonId ?? '待分配'}</td>
                    <td>
                      <span className="badge badge--neutral">
                        {STAGE_LABELS[merchant.lifecycleStage] ?? merchant.lifecycleStage}
                      </span>
                    </td>
                    <td>
                      <div className="telesales__row-actions">
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={busyKey?.startsWith(`call:${merchant.merchantId}:`)}
                          onClick={() => void simulateCall(merchant.merchantId, 'successful')}
                        >
                          模拟 AI 外呼
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          disabled={busyKey?.startsWith(`call:${merchant.merchantId}:`)}
                          onClick={() =>
                            void simulateCall(merchant.merchantId, 'compliance_risk')
                          }
                        >
                          模拟风险
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="telesales__section-header">
          <div>
            <h3>人工接续队列</h3>
            <p>高意向、回电请求与人工请求自动生成 P0/P1 跟进任务。</p>
          </div>
        </header>
        {(workspace?.followups.length ?? 0) === 0 ? (
          <p className="muted">暂无跟进任务。</p>
        ) : (
          <div className="telesales__followups">
            {workspace?.followups.slice(0, 8).map((followup) => (
              <article key={followup.followupId}>
                <span className={`badge badge--${followup.priority.toLowerCase()}`}>
                  {followup.priority}
                </span>
                <div>
                  <strong>{followup.recommendedAction}</strong>
                  <small>
                    {followup.merchantId} · {followup.salespersonId} ·{' '}
                    {new Date(followup.scheduledAt).toLocaleString('zh-CN')}
                  </small>
                </div>
                {followup.status !== 'completed' ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={busyKey === `followup:${followup.followupId}`}
                    onClick={() =>
                      void runAction(
                        `followup:${followup.followupId}`,
                        {
                          method: 'POST',
                          path: `/api/telesales/followups/${encodeURIComponent(
                            followup.followupId
                          )}/complete`,
                          idempotencyKey: `followup-complete:${followup.followupId}`
                        },
                        '人工跟进已完成'
                      )
                    }
                  >
                    完成跟进
                  </button>
                ) : (
                  <span className="ok">已完成</span>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {(workspace?.adjustmentSuggestions.length ?? 0) > 0 ? (
        <section className="panel telesales__suggestions">
          <h3>AI 调整建议</h3>
          <ul>
            {workspace?.adjustmentSuggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
