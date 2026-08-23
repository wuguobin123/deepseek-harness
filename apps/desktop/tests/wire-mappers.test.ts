import { describe, expect, it } from 'vitest';
import { mapWorkbenchResponse } from '../src/main/wire-mappers';
import { AssistantResponseSchema } from '../src/shared/contracts';
import { taskConversationId } from '../src/renderer/features/tasks/TasksPage';

describe('workbench backend wire mapping', () => {
  it('camelizes paginated task list responses', () => {
    expect(
      mapWorkbenchResponse(
        '/api/tasks?limit=20',
        'GET',
        {
          items: [
            {
              id: 'CMD-PAGE-1',
              source: 'workflow',
              message: '工作流任务',
              status: 'awaiting_confirmation',
              updated_at: '2026-08-05T12:00:00+08:00',
              trace_id: 'trace-1',
              detail: '业务工作流',
              phase: 'awaiting_confirmation',
              version: 1,
              conversation_id: null
            }
          ],
          next_cursor: 'eyJ2ZXJzaW9uIjoxLCJ3b3JrZmxvdyI6bnVsbCwiYWdlbnQiOm51bGx9'
        },
        200
      )
    ).toEqual({
      items: [
        {
          id: 'CMD-PAGE-1',
          source: 'workflow',
          message: '工作流任务',
          status: 'awaiting_confirmation',
          updatedAt: '2026-08-05T12:00:00+08:00',
          traceId: 'trace-1',
          detail: '业务工作流',
          phase: 'awaiting_confirmation',
          version: 1,
          conversationId: null
        }
      ],
      nextCursor: 'eyJ2ZXJzaW9uIjoxLCJ3b3JrZmxvdyI6bnVsbCwiYWdlbnQiOm51bGx9'
    });
  });

  it('camelizes agent task metadata used to restore its conversation', () => {
    expect(
      mapWorkbenchResponse(
        '/api/agent-runs?limit=100',
        'GET',
        [
          {
            run_id: 'conversation-agent:RUN-1',
            task_id: 'conversation:CNV-1',
            objective: '总结文档',
            updated_at: '2026-08-03T10:00:00+08:00'
          }
        ],
        200
      )
    ).toEqual([
      {
        runId: 'conversation-agent:RUN-1',
        taskId: 'conversation:CNV-1',
        objective: '总结文档',
        updatedAt: '2026-08-03T10:00:00+08:00'
      }
    ]);
  });

  it('resolves only explicit task-to-conversation associations', () => {
    expect(taskConversationId({ taskId: 'conversation:CNV-AGENT-1' })).toBe(
      'CNV-AGENT-1'
    );
    expect(taskConversationId({ input: { conversationId: 'CNV-WORKFLOW' } })).toBe(
      'CNV-WORKFLOW'
    );
    expect(taskConversationId({ input: { objectId: 'OBJ-1' } })).toBeUndefined();
  });

  it('resolves trigger command conversations from step result output', () => {
    expect(
      taskConversationId({
        input: { preplanned: true, sourceType: 'trigger' },
        execution: {
          stepResults: [
            {
              stepId: 'step-0',
              output: { conversationId: 'CNV-AUTO-1', runId: 'RUN-1' }
            }
          ]
        }
      })
    ).toBe('CNV-AUTO-1');
    expect(
      taskConversationId({
        execution: { stepResults: [{ stepId: 'step-0', output: null }] }
      })
    ).toBeUndefined();
  });

  it('camelizes persistent conversation API responses', () => {
    const mapped = mapWorkbenchResponse(
      '/api/conversations?status=active&limit=50',
      'GET',
      {
        items: [
          {
            conversation_id: 'CNV-1',
            conversation_type: 'assistant',
            status: 'active',
            title: '天气问答',
            last_sequence: 2,
            last_message_at: '2026-07-29T08:00:00Z',
            created_at: '2026-07-29T07:59:00Z',
            updated_at: '2026-07-29T08:00:00Z'
          }
        ],
        next_cursor: null
      },
      200
    );

    expect(mapped).toEqual({
      items: [
        {
          conversationId: 'CNV-1',
          conversationType: 'assistant',
          status: 'active',
          title: '天气问答',
          lastSequence: 2,
          lastMessageAt: '2026-07-29T08:00:00Z',
          createdAt: '2026-07-29T07:59:00Z',
          updatedAt: '2026-07-29T08:00:00Z'
        }
      ],
      nextCursor: null
    });
  });

  it('accepts nullable optional source fields from older assistant responses', () => {
    const parsed = AssistantResponseSchema.parse({
      answer: '今天有 2 个高意向客户。',
      sources: [
        { title: '电话销售结果', uri: null, abstract: null, score: null }
      ],
      supplementalAnswers: [],
      suggestedActions: [],
      traceId: 'TRACE-NULL-SOURCE'
    });

    expect(parsed.sources[0]).toMatchObject({
      title: '电话销售结果',
      uri: undefined,
      abstract: undefined,
      score: undefined
    });
  });

  it('maps execution history and verification artifacts to renderer casing', () => {
    const mapped = mapWorkbenchResponse(
      '/api/history',
      'GET',
      {
        firings: [
          {
            firing_id: 'FIR-1',
            trigger_id: 'TRG-1',
            command_id: 'CMD-1',
            status: 'succeeded',
            scheduled_for: '2026-07-28T09:00:00+00:00',
            created_at: '2026-07-28T09:00:00+00:00',
            updated_at: '2026-07-28T09:00:01+00:00'
          }
        ],
        commands: [
          {
            command_id: 'CMD-1',
            status: 'completed',
            message: 'trigger TRG-1',
            trace_id: 'TRACE-1',
            updated_at: '2026-07-28T09:00:01+00:00'
          }
        ],
        verification_artifacts: [
          {
            artifact_id: 'VER-1',
            command_id: 'CMD-1',
            capability_id: 'oa.notification.send',
            created_at: '2026-07-28T09:00:01+00:00'
          }
        ]
      },
      200
    ) as Record<string, Array<Record<string, unknown>>>;

    expect(mapped.firings[0]).toMatchObject({
      firingId: 'FIR-1',
      triggerId: 'TRG-1',
      commandId: 'CMD-1',
      status: 'succeeded'
    });
    expect(mapped.commands[0]).toMatchObject({
      commandId: 'CMD-1',
      traceId: 'TRACE-1'
    });
    expect(mapped.verificationArtifacts[0]).toMatchObject({
      artifactId: 'VER-1',
      capabilityId: 'oa.notification.send'
    });
  });

  it('maps authorize-open response to the verified-link contract', () => {
    expect(
      mapWorkbenchResponse(
        '/api/verification-artifacts/VER-1/open',
        'POST',
        {
          url: 'https://oa.example.com/notifications/N-1',
          expires_at: '2026-07-28T10:00:00+00:00',
          trace_id: 'TRACE-1'
        },
        200
      )
    ).toEqual({
      url: 'https://oa.example.com/notifications/N-1',
      expiresAt: '2026-07-28T10:00:00+00:00',
      traceId: 'TRACE-1'
    });
  });

  it('maps nested anomaly evidence and exposes the artifact id', () => {
    expect(
      mapWorkbenchResponse(
        '/api/anomalies/ANM-1',
        'GET',
        {
          anomaly: {
            anomaly_id: 'ANM-1',
            title: 'OA 失败',
            severity: 'high',
            status: 'pending',
            version: 1
          },
          occurrences: [],
          conversation: null,
          verification_artifacts: [
            {
              artifact_id: 'VER-1',
              created_at: '2026-07-28T09:00:00+00:00',
              schema_version: 1,
              snapshot: { notification_id: 'N-1' }
            }
          ]
        },
        200
      )
    ).toMatchObject({
      anomalyId: 'ANM-1',
      title: 'OA 失败',
      verificationArtifactId: 'VER-1',
      snapshot: {
        fields: { notification_id: 'N-1' }
      }
    });
  });

  it('maps the telesales workspace into the renderer contract', () => {
    expect(
      mapWorkbenchResponse(
        '/api/telesales/workspace?plan_date=2026-07-28',
        'GET',
        {
          plan: {
            plan_id: 'PLAN-1',
            plan_date: '2026-07-28',
            target_gmv: 100000,
            target_conversions: 20,
            target_outbound_calls: 100,
            human_calls_allocated: 30,
            ai_calls_allocated: 70,
            status: 'draft'
          },
          conversion_funnel: {
            called: 2,
            connected: 2,
            intent: 1,
            ai_calls: 2,
            human_calls: null,
            followup: 1
          },
          quality_summary: {
            total_inspections: 2,
            avg_compliance_score: 85,
            avg_quality_score: 82,
            high_risk_count: 1
          },
          call_target_completion: 0.02,
          adjustment_suggestions: ['暂停高风险话术'],
          merchants: [
            {
              merchant_id: 'M-1',
              name: '西湖小馆',
              category: '餐饮',
              region: '杭州',
              phone: '138****8001',
              assigned_salesperson_id: 'agent-001',
              tier: 'A',
              lifecycle_stage: 'interested',
              version: 2
            }
          ],
          followups: [],
          inspections: [],
          campaigns: [
            {
              campaign_id: 'CMP-1',
              name: '沉睡客户唤醒',
              status: 'pending_approval',
              audience_count: 280,
              excluded_count: 12,
              schedule_window: '10:00–18:00',
              script_version: 'V2',
              metrics: {},
              precheck: [{ key: 'opt_out', label: '已排除退订客户', passed: true }],
              version: 1,
              updated_at: '2026-07-28T09:00:00Z'
            }
          ],
          governance: {
            pending_approvals: 1,
            queued_external_effects: 0,
            completed_campaigns: 0
          }
        },
        200
      )
    ).toMatchObject({
      plan: { planId: 'PLAN-1', aiCallsAllocated: 70 },
      conversionFunnel: { called: 2, humanCalls: 0 },
      merchants: [{ merchantId: 'M-1', lifecycleStage: 'interested' }],
      campaigns: [{ campaignId: 'CMP-1', audienceCount: 280 }],
      governance: { pendingApprovals: 1 }
    });
  });

  it('maps assistant, command, and knowledge payloads recursively', () => {
    expect(
      mapWorkbenchResponse(
        '/api/assistant',
        'POST',
        {
          answer: '每年享有带薪年假。',
          sources: [{ capability_id: 'operations.knowledge_search' }],
          supplemental_answers: [],
          suggested_actions: [{ id: 'next', label: '查看流程' }],
          trace_id: 'TRACE-AI'
        },
        200
      )
    ).toMatchObject({
      sources: [{ capabilityId: 'operations.knowledge_search' }],
      supplementalAnswers: [],
      suggestedActions: [{ id: 'next' }],
      traceId: 'TRACE-AI'
    });

    expect(
      mapWorkbenchResponse(
        '/api/commands/preview',
        'POST',
        {
          kind: 'command',
          message: '请确认',
          command: {
            command_id: 'CMD-1',
            original_message: '生成清单',
            steps: [{ step_id: 'S-1', capability_id: 'crm.followup.create' }],
            policy: { allowed_roles: ['supervisor'] },
            execution: { next_actions: [] }
          }
        },
        200
      )
    ).toMatchObject({
      command: {
        commandId: 'CMD-1',
        originalMessage: '生成清单',
        steps: [{ stepId: 'S-1', capabilityId: 'crm.followup.create' }],
        policy: { allowedRoles: ['supervisor'] },
        execution: { nextActions: [] }
      }
    });

    expect(
      mapWorkbenchResponse(
        '/api/knowledge/documents',
        'GET',
        { documents: [{ doc_id: 'DOC-1', chunk_count: 3, updated_at: 'now' }] },
        200
      )
    ).toEqual({
      documents: [{ docId: 'DOC-1', chunkCount: 3, updatedAt: 'now' }]
    });
  });
});
