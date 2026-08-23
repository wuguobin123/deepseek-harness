// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '../src/renderer/features/assistant/AssistantContext';

// ErrorMessage 通过 useAssistant 读取 busy/retryMessage；测试只关心渲染输出，
// mock 掉 hook（保留模块其余导出，AssistantPage 还从中 import 大量符号）。
vi.mock('../src/renderer/features/assistant/AssistantContext', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../src/renderer/features/assistant/AssistantContext')
    >();
  return {
    ...original,
    useAssistant: () => ({ busy: false, retryMessage: vi.fn() })
  };
});

import { ErrorMessage } from '../src/renderer/features/assistant/AssistantPage';

type ErrorAssistantMessage = Extract<AssistantMessage, { kind: 'error' }>;

function makeErrorMessage(
  overrides: Partial<ErrorAssistantMessage> = {}
): ErrorAssistantMessage {
  return {
    id: 'error-1',
    role: 'assistant',
    kind: 'error',
    content: '未满足用户要求的全部交付条件，任务未完成。',
    request: {
      message: '/ui-ux-pro-max 设计一个电商首页',
      context: { page: 'assistant', label: '助手' }
    },
    ...overrides
  };
}

describe('assistant error card partial answer', () => {
  it('renders the goal-contract partial answer above the retry button', () => {
    const markup = renderToStaticMarkup(
      <ErrorMessage
        message={makeErrorMessage({
          partialAnswer:
            '本轮未满足用户要求的全部交付条件，未将任务标记为完成。\n\n阶段性结果：\n已读取 ui-ux-pro-max 技能指令。'
        })}
      />
    );

    expect(markup).toContain('暂时无法完成');
    expect(markup).toContain('未满足用户要求的全部交付条件，任务未完成。');
    // 阶段性结果以 Markdown 渲染，且位于「重新执行」按钮上方。
    const partialIndex = markup.indexOf('已读取 ui-ux-pro-max 技能指令。');
    expect(partialIndex).toBeGreaterThan(-1);
    expect(markup.indexOf('assistant-retry')).toBeGreaterThan(partialIndex);
    expect(markup).toContain('assistant-markdown');
  });

  it('keeps the current rendering when the event carries no answer', () => {
    const markup = renderToStaticMarkup(
      <ErrorMessage message={makeErrorMessage()} />
    );

    expect(markup).toContain('暂时无法完成');
    expect(markup).toContain('assistant-retry');
    expect(markup).not.toContain('assistant-markdown');
  });
});
