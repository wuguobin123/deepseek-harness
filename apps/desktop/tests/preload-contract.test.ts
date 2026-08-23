/**
 * Preload contract tests.
 *
 * For each method on `window.workbenchApi`, assert that inputs are validated
 * by the Zod schemas in `src/shared/contracts.ts`. The point is to make sure
 * that the preload bridge refuses malformed data before it ever reaches the
 * main process.
 */
import { describe, expect, it } from 'vitest';
import {
  AnomalyStreamEventSchema,
  AppUpdateStateSchema,
  AssistantStreamEventSchema,
  AssistantStreamInputSchema,
  BrowserActionSchema,
  BrowserBoundsSchema,
  BrowserNavigateInputSchema,
  ConversationMessagePageSchema,
  EmailCodeRequestSchema,
  RequestInputSchema,
  SessionUpdateSchema,
  VerificationOpenResultSchema,
  AccountAuthenticationSchema
} from '../src/shared/contracts';

describe('ConversationMessagePageSchema', () => {
  it('accepts null nextAfterSequence on the final page', () => {
    const result = ConversationMessagePageSchema.safeParse({
      conversationId: 'CNV-1',
      messages: [],
      nextAfterSequence: null,
      hasMore: false
    });

    expect(result.success).toBe(true);
  });
});

describe('RequestInputSchema', () => {
  it('accepts a typical GET', () => {
    const ok = RequestInputSchema.safeParse({
      method: 'GET',
      path: '/api/anomalies?status=pending'
    });
    expect(ok.success).toBe(true);
  });

  it('rejects paths outside /api/', () => {
    const bad = RequestInputSchema.safeParse({ method: 'GET', path: '/admin/users' });
    expect(bad.success).toBe(false);
  });

  it('accepts POST with idempotency key and expected version', () => {
    const ok = RequestInputSchema.safeParse({
      method: 'POST',
      path: '/api/triggers',
      body: { foo: 'bar' },
      idempotencyKey: 'abc',
      expectedVersion: 1
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unknown methods', () => {
    const bad = RequestInputSchema.safeParse({ method: 'TRACE', path: '/api/x' });
    expect(bad.success).toBe(false);
  });
});

describe('SessionUpdateSchema', () => {
  it('requires at least one field', () => {
    const bad = SessionUpdateSchema.safeParse({});
    expect(bad.success).toBe(false);
  });

  it('accepts a tenant id only', () => {
    const ok = SessionUpdateSchema.safeParse({ tenantId: 'tenant-a' });
    expect(ok.success).toBe(true);
  });

  it('rejects extra fields', () => {
    const bad = SessionUpdateSchema.safeParse({ tenantId: 'tenant-a', adminKey: 'secret' });
    expect(bad.success).toBe(false);
  });
});

describe('AnomalyStreamEventSchema', () => {
  it('accepts a heartbeat', () => {
    const ok = AnomalyStreamEventSchema.safeParse({
      type: 'heartbeat',
      seq: 1,
      sentAt: '2026-07-27T00:00:00Z'
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unknown event types', () => {
    const bad = AnomalyStreamEventSchema.safeParse({
      type: 'totally-not-real',
      seq: 1
    });
    expect(bad.success).toBe(false);
  });
});

describe('assistant stream schemas', () => {
  it('accepts a bounded stream request and typed deltas', () => {
    expect(
      AssistantStreamInputSchema.safeParse({
        requestId: 'stream-1',
        conversationId: 'CNV-1',
        message: '总结当前会话',
        clientMessageId: 'desktop-1',
        attachmentIds: []
      }).success
    ).toBe(true);
    expect(
      AssistantStreamEventSchema.safeParse({
        type: 'accepted',
        clientMessageId: 'desktop-1',
        runId: 'RUN-1'
      }).success
    ).toBe(true);
    expect(
      AssistantStreamEventSchema.safeParse({
        type: 'delta',
        index: 0,
        delta: '正在生成',
        candidateId: 'run-1:turn:1',
        turn: 1
      }).success
    ).toBe(true);
    for (const event of [
      {
        type: 'candidate_start',
        candidateId: 'run-1:turn:1',
        turn: 1
      },
      {
        type: 'discard',
        candidateId: 'run-1:turn:1',
        turn: 1,
        reason: 'tool_use'
      },
      {
        type: 'commit',
        candidateId: 'run-1:turn:2',
        turn: 2,
        text: '最终回答'
      },
      {
        type: 'replace',
        candidateId: 'run-1:turn:2',
        text: '经过事实校验的最终回答',
        reason: 'authoritative_final'
      }
    ]) {
      expect(AssistantStreamEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects malformed assistant stream events', () => {
    expect(
      AssistantStreamEventSchema.safeParse({
        type: 'delta',
        index: -1,
        delta: 123
      }).success
    ).toBe(false);
  });
});

describe('VerificationOpenResultSchema', () => {
  it('requires an https URL', () => {
    const ok = VerificationOpenResultSchema.safeParse({
      url: 'https://example.com/foo',
      expiresAt: '2026-07-27T00:00:00Z',
      traceId: 't-1'
    });
    expect(ok.success).toBe(true);
  });

  it('rejects non-URL values', () => {
    const bad = VerificationOpenResultSchema.safeParse({
      url: 'not-a-url',
      expiresAt: '2026-07-27T00:00:00Z',
      traceId: 't-1'
    });
    expect(bad.success).toBe(false);
  });
});

describe('embedded browser schemas', () => {
  it('accepts safe navigation and bounded browser actions', () => {
    expect(
      BrowserNavigateInputSchema.safeParse({ url: 'https://example.com/search?q=ai' })
        .success
    ).toBe(true);
    expect(
      BrowserBoundsSchema.safeParse({ x: 600, y: 120, width: 700, height: 650 })
        .success
    ).toBe(true);
    expect(
      BrowserActionSchema.safeParse({ type: 'click', targetText: '下一页' }).success
    ).toBe(true);
  });

  it('rejects executable and local-file browser URLs', () => {
    expect(
      BrowserNavigateInputSchema.safeParse({ url: 'javascript:alert(1)' }).success
    ).toBe(false);
    expect(
      BrowserNavigateInputSchema.safeParse({ url: 'file:///etc/passwd' }).success
    ).toBe(false);
});

describe('EmailCodeRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(
      EmailCodeRequestSchema.safeParse({
        baseUrl: 'https://example.com',
        email: 'a@b.com'
      }).success
    ).toBe(true);
  });

  it('rejects non-URL baseUrl', () => {
    expect(
      EmailCodeRequestSchema.safeParse({
        baseUrl: 'not-a-url',
        email: 'a@b.com'
      }).success
    ).toBe(false);
  });

  it('rejects malformed email', () => {
    expect(
      EmailCodeRequestSchema.safeParse({
        baseUrl: 'https://example.com',
        email: 'not-an-email'
      }).success
    ).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(
      EmailCodeRequestSchema.safeParse({
        baseUrl: 'https://example.com',
        email: 'a@b.com',
        evil: 'true'
      }).success
    ).toBe(false);
  });
});

describe('AppUpdateStateSchema', () => {
  it('accepts each status of the update state machine', () => {
    expect(
      AppUpdateStateSchema.safeParse({ status: 'idle', currentVersion: '0.1.0' }).success
    ).toBe(true);
    expect(
      AppUpdateStateSchema.safeParse({
        status: 'available',
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        notes: '修复若干问题',
        downloadUrl: 'http://example.com/releases/app.dmg',
        checkedAt: '2026-08-05T00:00:00Z'
      }).success
    ).toBe(true);
    expect(
      AppUpdateStateSchema.safeParse({
        status: 'error',
        currentVersion: '0.1.0',
        error: 'HTTP 404'
      }).success
    ).toBe(true);
  });

  it('rejects unknown statuses', () => {
    expect(
      AppUpdateStateSchema.safeParse({ status: 'downloading', currentVersion: '0.1.0' }).success
    ).toBe(false);
  });
});

describe('AccountAuthenticationSchema verificationCode', () => {
  it('accepts a 6-digit code for signup', () => {
    const result = AccountAuthenticationSchema.safeParse({
      mode: 'signup',
      baseUrl: 'https://example.com',
      email: 'a@b.com',
      password: 'longenoughpwd',
      displayName: 'Alice',
      verificationCode: '123456'
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric verificationCode', () => {
    const result = AccountAuthenticationSchema.safeParse({
      mode: 'signup',
      baseUrl: 'https://example.com',
      email: 'a@b.com',
      password: 'longenoughpwd',
      displayName: 'Alice',
      verificationCode: 'abcdef'
    });
    expect(result.success).toBe(false);
  });
});
});
