import { describe, expect, it } from 'vitest';
import {
  claimClientAction,
  isDispatchableClientAction,
  shouldApplyExternalResult
} from '../src/renderer/features/assistant/AssistantContext';

const action = {
  actionId: 'action-1',
  type: 'browser_extract' as const,
  url: 'https://example.com',
  focus: '',
  actionStatus: 'pending'
};

describe('stale client action protection', () => {
  it('does not dispatch client actions from a completed turn', () => {
    expect(isDispatchableClientAction({ runId: 'run-1', status: 'completed' }, action)).toBe(false);
    expect(isDispatchableClientAction({ runId: 'run-1' }, action)).toBe(false);
  });

  it('dispatches a waiting action once', () => {
    const dispatched = new Set<string>();
    const turn = { runId: 'run-1', runStatus: 'waiting_input' };
    expect(claimClientAction(dispatched, turn, action)).toBe(true);
    expect(claimClientAction(dispatched, turn, action)).toBe(false);
  });

  it('rejects late or differently bound external results', () => {
    const binding = { runId: 'run-1', actionId: 'action-1' };
    expect(shouldApplyExternalResult(binding, binding, binding)).toBe(true);
    expect(
      shouldApplyExternalResult(binding, { runId: 'run-2', actionId: 'action-1' }, binding)
    ).toBe(false);
    expect(
      shouldApplyExternalResult(binding, { runId: 'run-1', actionId: 'action-2' }, binding)
    ).toBe(false);
  });
});
