import type {
  Anomaly,
  AnomalyStreamEvent,
  TelesalesWorkspace,
  Trigger
} from '../shared/contracts';

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {};
}

function camelKey(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Row).map(([key, item]) => [camelKey(key), camelize(item)])
  );
}

function anomaly(value: unknown): Anomaly {
  const item = row(value);
  const rawStatus = String(item.status ?? 'pending');
  const status: Anomaly['status'] =
    rawStatus === 'fixing' ||
    rawStatus === 'awaiting_approval' ||
    rawStatus === 'verifying' ||
    rawStatus === 'resolved' ||
    rawStatus === 'ignored'
      ? rawStatus
      : 'pending';
  const rawSeverity = String(item.severity ?? 'medium');
  const severity: Anomaly['severity'] =
    rawSeverity === 'low' ||
    rawSeverity === 'high' ||
    rawSeverity === 'critical'
      ? rawSeverity
      : 'medium';
  return {
    anomalyId: String(item.anomaly_id ?? ''),
    title: String(item.title ?? ''),
    description: String(item.description ?? ''),
    severity,
    status,
    sourcePlugin: String(item.source_plugin ?? ''),
    sourceCapability: String(item.source_capability ?? ''),
    ownerActorId: (item.owner_actor_id as string | null) ?? null,
    occurrenceCount: Number(item.occurrence_count ?? 1),
    firstSeenAt: String(item.first_seen_at ?? ''),
    lastSeenAt: String(item.last_seen_at ?? ''),
    deepLink: (item.deep_link as string | null) ?? null,
    version: Number(item.version ?? 1)
  };
}

function trigger(value: unknown): Trigger {
  const item = row(value);
  const rawType = String(item.trigger_type ?? 'cron');
  const type: Trigger['type'] =
    rawType === 'event' || rawType === 'condition' ? rawType : 'cron';
  const rawStatus = String(item.status ?? 'draft');
  const status: Trigger['status'] =
    rawStatus === 'enabled' ||
    rawStatus === 'paused' ||
    rawStatus === 'error' ||
    rawStatus === 'archived'
      ? rawStatus
      : 'draft';
  return {
    triggerId: String(item.trigger_id ?? ''),
    pluginId: String(item.plugin_id ?? ''),
    capabilityId: String(item.capability_id ?? ''),
    type,
    status,
    version: Number(item.version ?? 1),
    config: row(item.config),
    arguments: row(item.arguments),
    condition: item.condition ? row(item.condition) : null,
    nextFireAt: (item.next_fire_at as string | null) ?? null,
    lastFiredAt: (item.last_fired_at as string | null) ?? null,
    createdAt: String(item.created_at ?? ''),
    updatedAt: String(item.updated_at ?? '')
  };
}

function telesalesWorkspace(value: unknown): TelesalesWorkspace {
  const data = row(value);
  const plan = data.plan ? row(data.plan) : null;
  const funnel = row(data.conversion_funnel);
  const quality = row(data.quality_summary);
  const governance = row(data.governance);
  const merchants = Array.isArray(data.merchants) ? data.merchants : [];
  const followups = Array.isArray(data.followups) ? data.followups : [];
  const inspections = Array.isArray(data.inspections) ? data.inspections : [];
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  return {
    plan: plan
      ? {
          planId: String(plan.plan_id ?? ''),
          planDate: String(plan.plan_date ?? ''),
          targetGmv: Number(plan.target_gmv ?? 0),
          targetConversions: Number(plan.target_conversions ?? 0),
          targetOutboundCalls: Number(plan.target_outbound_calls ?? 0),
          humanCallsAllocated: Number(plan.human_calls_allocated ?? 0),
          aiCallsAllocated: Number(plan.ai_calls_allocated ?? 0),
          status: String(plan.status ?? '')
        }
      : null,
    conversionFunnel: {
      called: Number(funnel.called ?? 0),
      connected: Number(funnel.connected ?? 0),
      intent: Number(funnel.intent ?? 0),
      aiCalls: Number(funnel.ai_calls ?? 0),
      humanCalls: Number(funnel.human_calls ?? 0),
      followup: Number(funnel.followup ?? 0)
    },
    qualitySummary: {
      totalInspections: Number(quality.total_inspections ?? 0),
      avgComplianceScore: Number(quality.avg_compliance_score ?? 0),
      avgQualityScore: Number(quality.avg_quality_score ?? 0),
      highRiskCount: Number(quality.high_risk_count ?? 0)
    },
    callTargetCompletion: Number(data.call_target_completion ?? 0),
    adjustmentSuggestions: Array.isArray(data.adjustment_suggestions)
      ? data.adjustment_suggestions.map(String)
      : [],
    merchants: merchants.map((value) => {
      const item = row(value);
      return {
        merchantId: String(item.merchant_id ?? ''),
        name: String(item.name ?? ''),
        category: String(item.category ?? ''),
        region: String(item.region ?? ''),
        phone: String(item.phone ?? ''),
        assignedSalespersonId:
          (item.assigned_salesperson_id as string | null) ?? null,
        tier: String(item.tier ?? ''),
        lifecycleStage: String(item.lifecycle_stage ?? ''),
        version: Number(item.version ?? 1)
      };
    }),
    followups: followups.map((value) => {
      const item = row(value);
      return {
        followupId: String(item.followup_id ?? ''),
        merchantId: String(item.merchant_id ?? ''),
        sourceCallId: (item.source_call_id as string | null) ?? null,
        salespersonId: String(item.salesperson_id ?? ''),
        priority: String(item.priority ?? ''),
        scheduledAt: String(item.scheduled_at ?? ''),
        recommendedAction: String(item.recommended_action ?? ''),
        status: String(item.status ?? '')
      };
    }),
    inspections: inspections.map((value) => {
      const item = row(value);
      const violations = Array.isArray(item.violations) ? item.violations : [];
      return {
        inspectionId: String(item.inspection_id ?? ''),
        callId: String(item.call_id ?? ''),
        complianceScore: Number(item.compliance_score ?? 0),
        salesQualityScore: Number(item.sales_quality_score ?? 0),
        riskLevel: String(item.risk_level ?? 'L0'),
        violations: violations.map(row),
        inspectedAt: String(item.inspected_at ?? '')
      };
    }),
    campaigns: campaigns.map((value) => {
      const item = row(value);
      const precheck = Array.isArray(item.precheck) ? item.precheck : [];
      return {
        campaignId: String(item.campaign_id ?? ''),
        name: String(item.name ?? ''),
        status: String(item.status ?? ''),
        audienceCount: Number(item.audience_count ?? 0),
        excludedCount: Number(item.excluded_count ?? 0),
        scheduleWindow: String(item.schedule_window ?? ''),
        scriptVersion: String(item.script_version ?? ''),
        metrics: row(item.metrics),
        precheck: precheck.map((value) => {
          const check = row(value);
          return {
            key: String(check.key ?? ''),
            label: String(check.label ?? ''),
            passed: Boolean(check.passed)
          };
        }),
        version: Number(item.version ?? 1),
        updatedAt: String(item.updated_at ?? '')
      };
    }),
    governance: {
      pendingApprovals: Number(governance.pending_approvals ?? 0),
      queuedExternalEffects: Number(governance.queued_external_effects ?? 0),
      completedCampaigns: Number(governance.completed_campaigns ?? 0)
    }
  };
}

export function mapWorkbenchResponse(
  path: string,
  method: string,
  body: unknown,
  status: number
): unknown {
  if (status >= 400) {
    const data = row(body);
    if ('detail' in data) {
      return {
        error: {
          code: `HTTP_${status}`,
          message:
            typeof data.detail === 'string'
              ? data.detail
              : JSON.stringify(data.detail)
        }
      };
    }
    return body;
  }
  const pathOnly = path.split('?')[0];
  const data = row(body);
  if (pathOnly === '/api/anomalies' && method === 'GET') {
    const items = Array.isArray(data.anomalies) ? data.anomalies : [];
    return {
      items: items.map(anomaly),
      nextCursor: (data.next_cursor as string | null) ?? null
    };
  }
  if (
    /^\/api\/anomalies\/[A-Za-z0-9_-]+$/.test(pathOnly) &&
    method === 'GET'
  ) {
    const anomalyRow = row(data.anomaly);
    const occurrences = Array.isArray(data.occurrences)
      ? data.occurrences
      : [];
    const conversation = row(data.conversation);
    const artifacts = Array.isArray(data.verification_artifacts)
      ? data.verification_artifacts.map(row)
      : [];
    const firstArtifact = artifacts[0] ?? {};
    return {
      ...anomaly(anomalyRow),
      occurrences: occurrences.map((value) => {
        const item = row(value);
        const error = row(item.error);
        return {
          occurrenceId: String(item.occurrence_id ?? ''),
          commandId: (item.command_id as string | null) ?? null,
          errorCode: (item.error_code as string | null) ?? null,
          occurredAt: String(item.occurred_at ?? ''),
          message: String(error.message ?? item.message ?? '')
        };
      }),
      conversationId:
        (conversation.conversation_id as string | null) ?? null,
      verificationArtifactId:
        (firstArtifact.artifact_id as string | null) ?? null,
      traceId: String(anomalyRow.trace_id ?? ''),
      snapshot: firstArtifact.snapshot
        ? {
            capturedAt: String(firstArtifact.created_at ?? ''),
            schemaVersion: Number(firstArtifact.schema_version ?? 1),
            fields: row(firstArtifact.snapshot)
          }
        : null
    };
  }
  if (pathOnly === '/api/triggers' && method === 'GET') {
    const items = Array.isArray(data.triggers) ? data.triggers : [];
    return {
      items: items.map(trigger),
      nextCursor: (data.next_cursor as string | null) ?? null
    };
  }
  if (pathOnly === '/api/history' && method === 'GET') {
    const firings = Array.isArray(data.firings) ? data.firings : [];
    const commands = Array.isArray(data.commands) ? data.commands : [];
    const artifacts = Array.isArray(data.verification_artifacts)
      ? data.verification_artifacts
      : [];
    return {
      firings: firings.map((value) => {
        const item = row(value);
        return {
          firingId: String(item.firing_id ?? ''),
          triggerId: String(item.trigger_id ?? ''),
          commandId: (item.command_id as string | null) ?? null,
          status: String(item.status ?? ''),
          scheduledFor: (item.scheduled_for as string | null) ?? null,
          createdAt: String(item.created_at ?? ''),
          updatedAt: String(item.updated_at ?? '')
        };
      }),
      commands: commands.map((value) => {
        const item = row(value);
        return {
          commandId: String(item.command_id ?? ''),
          status: String(item.status ?? ''),
          message: String(item.message ?? ''),
          traceId: String(item.trace_id ?? ''),
          updatedAt: String(item.updated_at ?? '')
        };
      }),
      verificationArtifacts: artifacts.map((value) => {
        const item = row(value);
        return {
          artifactId: String(item.artifact_id ?? ''),
          commandId: (item.command_id as string | null) ?? null,
          capabilityId: String(item.capability_id ?? ''),
          createdAt: String(item.created_at ?? '')
        };
      })
    };
  }
  if (pathOnly === '/api/telesales/workspace' && method === 'GET') {
    return telesalesWorkspace(body);
  }
  if (
    pathOnly === '/api/assistant' ||
    pathOnly.startsWith('/api/conversations') ||
    pathOnly.startsWith('/api/commands') ||
    pathOnly.startsWith('/api/agent-runs') ||
    pathOnly === '/api/tasks' ||
    pathOnly.startsWith('/api/knowledge') ||
    pathOnly.startsWith('/api/connectors') ||
    pathOnly.startsWith('/api/workflows') ||
    pathOnly.startsWith('/api/model-accounts') ||
    pathOnly.startsWith('/api/skill-installations') ||
    pathOnly.startsWith('/api/skill-workshop') ||
    pathOnly === '/api/triggers/firings/recent' ||
    pathOnly === '/api/approvals' ||
    pathOnly === '/api/capabilities'
  ) {
    return camelize(body);
  }
  if (
    /^\/api\/verification-artifacts\/[A-Za-z0-9_-]+\/open$/.test(pathOnly) &&
    method === 'POST'
  ) {
    return {
      url: String(data.url ?? ''),
      expiresAt: String(data.expires_at ?? ''),
      traceId: String(data.trace_id ?? '')
    };
  }
  if (
    pathOnly.startsWith('/api/triggers') &&
    (method === 'POST' || method === 'PUT')
  ) {
    return trigger(data);
  }
  if (
    pathOnly.startsWith('/api/anomalies/') &&
    method === 'POST' &&
    !pathOnly.endsWith('/conversation')
  ) {
    return anomaly(data);
  }
  return body;
}

export function mapAnomalyStreamEvent(value: unknown): AnomalyStreamEvent | null {
  const data = row(value);
  const eventType = String(data.event_type ?? '');
  const payload = row(data.payload);
  const seq = Number(data.event_seq ?? 0);
  if (eventType === 'anomaly.resolved' || eventType === 'anomaly.ignored') {
    return {
      type: 'anomaly.resolved',
      seq,
      anomalyId: String(payload.anomaly_id ?? data.aggregate_id ?? '')
    };
  }
  if (
    eventType === 'anomaly.opened' ||
    eventType === 'anomaly.merged' ||
    eventType === 'anomaly.updated'
  ) {
    return {
      type: eventType === 'anomaly.updated' ? 'anomaly.updated' : 'anomaly.opened',
      seq,
      anomaly: anomaly({
        anomaly_id: payload.anomaly_id ?? data.aggregate_id,
        status: payload.status,
        severity: payload.severity,
        version: payload.version,
        last_seen_at: data.created_at
      })
    };
  }
  return null;
}
