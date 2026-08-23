import { afterEach, describe, expect, it, vi } from 'vitest';
import { workbenchApi } from '../src/renderer/api';
import { AssistantStreamEventSchema } from '../src/shared/contracts';

describe('assistant stream cancellation', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('closes the bridge stream and rejects promptly when aborted', async () => {
    const close = vi.fn();
    const streamAssistant = vi.fn(async () => close);
    (globalThis as { window?: unknown }).window = {
      workbenchApi: { streamAssistant }
    };
    const controller = new AbortController();
    const pending = workbenchApi.askConversationStream(
      {
        requestId: 'request-1',
        conversationId: 'CNV-1',
        message: 'incomplete query',
        clientMessageId: 'message-1',
        attachmentIds: [],
        deepMode: false
      },
      () => {},
      controller.signal
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});

describe('skill installation stream contract', () => {  it('accepts plural proposal events without dropping sibling proposals', () => {
    const proposal = (id: string, slug: string) => ({
      proposalId: id,
      uploadId: 'skillupload-1',
      skillRef: `uploaded://skillupload-1/${slug}`,
      slug,
      displayName: slug,
      summary: `${slug} summary`,
      version: 'abcdef123456',
      registry: 'uploaded',
      status: 'pending',
      expiresAt: 1_900_000_000
    });
    const event = AssistantStreamEventSchema.parse({
      type: 'skill_install_proposals',
      turn: 2,
      proposals: [proposal('proposal-1', 'alpha'), proposal('proposal-2', 'beta')]
    });
    expect(event.type).toBe('skill_install_proposals');
    if (event.type === 'skill_install_proposals') {
      expect(event.proposals.map((item) => item.slug)).toEqual(['alpha', 'beta']);
    }
  });

  it('accepts a read-only bundle inspection before approval proposals exist', () => {
    const event = AssistantStreamEventSchema.parse({
      type: 'skill_bundle_inspection',
      turn: 1,
      bundle: {
        uploadId: 'skillupload-1',
        bundleFilename: 'skills.zip',
        archiveSha256: 'a'.repeat(64),
        status: 'awaiting_selection',
        expiresAt: 1_900_000_000,
        candidates: [
          {
            slug: 'alpha',
            rootPath: 'repo/alpha',
            description: 'alpha skill',
            contentSha256: 'b'.repeat(64),
            selectable: true
          }
        ]
      }
    });
    expect(event.type).toBe('skill_bundle_inspection');
  });
});

describe('goal-contract failure stream contract', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const input = {
    requestId: 'request-1',
    conversationId: 'CNV-1',
    message: '/ui-ux-pro-max 设计一个电商首页',
    clientMessageId: 'message-1',
    attachmentIds: [],
    deepMode: false
  };

  it('parses the optional answer field on error events', () => {
    const event = AssistantStreamEventSchema.parse({
      type: 'error',
      error: {
        code: 'AGENT_RUN_FAILED',
        message: '未满足用户要求的全部交付条件，任务未完成。',
        answer: '阶段性结果：\n已读取 ui-ux-pro-max 技能指令。'
      }
    });
    expect(event.type).toBe('error');
    if (event.type === 'error') {
      expect(event.error.answer).toContain('阶段性结果');
    }
  });

  it('keeps error events without an answer valid (answer undefined)', () => {
    const event = AssistantStreamEventSchema.parse({
      type: 'error',
      error: { code: 'CANCELLED', message: '生成已停止' }
    });
    expect(event.type).toBe('error');
    if (event.type === 'error') {
      expect(event.error.answer).toBeUndefined();
    }
  });

  it('carries the partial answer through the stream error rejection', async () => {
    const streamAssistant = vi.fn(
      async (
        _input: unknown,
        listener: (event: unknown) => void
      ) => {
        listener({
          type: 'error',
          error: {
            code: 'AGENT_RUN_FAILED',
            message: '未满足用户要求的全部交付条件，任务未完成。',
            answer: '阶段性结果原文'
          }
        });
        return () => {};
      }
    );
    (globalThis as { window?: unknown }).window = {
      workbenchApi: { streamAssistant }
    };

    await expect(
      workbenchApi.askConversationStream(input, () => {})
    ).rejects.toMatchObject({
      code: 'AGENT_RUN_FAILED',
      partialAnswer: '阶段性结果原文'
    });
  });

  it('rejects without partialAnswer when the error event has no answer', async () => {
    const streamAssistant = vi.fn(
      async (
        _input: unknown,
        listener: (event: unknown) => void
      ) => {
        listener({
          type: 'error',
          error: { code: 'RUN_FAILED', message: '回答生成失败' }
        });
        return () => {};
      }
    );
    (globalThis as { window?: unknown }).window = {
      workbenchApi: { streamAssistant }
    };

    await expect(
      workbenchApi.askConversationStream(input, () => {})
    ).rejects.toMatchObject({ code: 'RUN_FAILED', partialAnswer: undefined });
  });
});
