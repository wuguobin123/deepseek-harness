// @vitest-environment happy-dom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixSuggestionButtons } from '../src/renderer/components/FixSuggestionButtons';
import type { FixSuggestion } from '../src/shared/contracts';

const sample: FixSuggestion[] = [
  { action: 'retry', title: '稍后重试', priority: 1, payload: { retry_after: 60 } },
  { action: 'update_api_key', title: '更新 API 密钥', priority: 2, payload: {} },
  { action: 'contact_admin', title: '联系管理员', priority: 3, payload: {} }
];

describe('FixSuggestionButtons', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    if (root) {
      root.unmount();
    }
    if (container) {
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it('returns null when no suggestions are provided', () => {
    expect(renderToStaticMarkup(<FixSuggestionButtons suggestions={[]} />)).toBe('');
    expect(renderToStaticMarkup(<FixSuggestionButtons suggestions={undefined as unknown as FixSuggestion[]} />)).toBe('');
  });

  it('renders one button per suggestion, sorted by priority ascending', () => {
    const markup = renderToStaticMarkup(
      <FixSuggestionButtons
        suggestions={[sample[2], sample[0], sample[1]]}
      />
    );
    const retryIndex = markup.indexOf('稍后重试');
    const keyIndex = markup.indexOf('更新 API 密钥');
    const adminIndex = markup.indexOf('联系管理员');
    expect(retryIndex).toBeGreaterThan(-1);
    expect(keyIndex).toBeGreaterThan(retryIndex);
    expect(adminIndex).toBeGreaterThan(keyIndex);
    expect(markup).toContain('data-testid="fix-suggestion-retry"');
    expect(markup).toContain('data-testid="fix-suggestion-update_api_key"');
  });

  it('invokes onAction with action + payload when provided', async () => {
    const { act } = await import('react');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const handler = vi.fn();
    await act(async () => {
      root.render(React.createElement(FixSuggestionButtons, { suggestions: sample, onAction: handler }));
    });
    const button = container.querySelector(
      'button[data-testid="fix-suggestion-retry"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledWith('retry', { retry_after: 60 });
  });

  it('dispatches a toast event when no onAction is provided (retry/wait)', async () => {
    const { act } = await import('react');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    await act(async () => {
      root.render(React.createElement(FixSuggestionButtons, { suggestions: [sample[0]] }));
    });
    const button = container.querySelector(
      'button[data-testid="fix-suggestion-retry"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const toast = dispatchSpy.mock.calls
      .map(([event]) => event as CustomEvent)
      .find((event) => event.type === 'workbench:fix-suggestion-toast');
    expect(toast).toBeDefined();
  });
});