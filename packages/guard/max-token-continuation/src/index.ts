/**
 * Bounded automatic continuation after an agent turn reaches its output-token cap.
 *
 * @module @deepseek-ai/dsh-max-token-continuation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name and durable injected-context provenance. */
export const name = 'max-token-continuation'

/** Model instruction used for every automatic continuation turn. */
export const CONTINUATION_PROMPT =
  'Continue the unfinished task from the exact point where the previous response was cut off. '
  + 'Do not restart, repeat the plan, or merely announce what you will do. '
  + 'For large HTML, documents, spreadsheets, tables, or code, prioritize completing and saving the artifact with html_build, doc_build, sheet_build, write, or edit; '
  + 'for a short chat request, close with a concise answer. Use the next required tool immediately when work remains, preserve completed work, and finish only after the task is actually complete.'

/** Plugin configuration. */
export interface Config {
  /** Maximum consecutive automatic continuation turns for one uninterrupted task. */
  maxContinuations?: number
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  maxContinuations: z.number().step(1).min(1).default(8),
})

/**
 * Return whether the latest completed model step in `turn` ended at the output-token cap.
 * @param events Session event log.
 * @param turn Turn number to inspect.
 * @returns Whether the step ended for max tokens.
 */
export function latestStepReachedMaxTokens(events: readonly SessionEvent[], turn: number): boolean {
  const finish = events.findLast(event => event.type === 'assistant/chunk'
    && event.data.turn === turn
    && event.data.chunk.type === 'finish')
  return finish?.type === 'assistant/chunk'
    && finish.data.chunk.type === 'finish'
    && finish.data.chunk.reason.kind === 'max-tokens'
}

interface ContinuationSource {
  readonly kind: 'plugin'
  readonly plugin: typeof name
  readonly form: 'notice'
  readonly summary: string
  readonly cause: 'max-tokens'
  readonly fromTurn: number
  readonly ordinal: number
  readonly limit: number
}

/**
 * Recognize and validate the durable continuation metadata.
 * @param source Unknown event source.
 * @returns Whether source is continuation metadata.
 */
export function isContinuationSource(source: unknown): source is ContinuationSource {
  if (typeof source !== 'object' || source === null) return false
  const value = source as Record<string, unknown>
  if (value.kind !== 'plugin' || value.plugin !== name || value.cause !== 'max-tokens'
    || value.form !== 'notice' || typeof value.summary !== 'string'
    || typeof value.fromTurn !== 'number' || !Number.isSafeInteger(value.fromTurn) || value.fromTurn <= 0
    || typeof value.ordinal !== 'number' || !Number.isSafeInteger(value.ordinal) || value.ordinal <= 0
    || typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit <= 0
    || value.ordinal > value.limit) return false
  return true
}

/** Rebuild the current consecutive continuation count from the durable log. */
function continuationState(events: readonly SessionEvent[]): { count: number; fromTurns: Set<number> } {
  let count = 0
  const fromTurns = new Set<number>()
  for (const event of events) {
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'user') {
        count = 0
        fromTurns.clear()
        continue
      }
      if (isContinuationSource(event.data.source)) {
        const source = event.data.source
        count = Math.max(count, source.ordinal)
        fromTurns.add(source.fromTurn)
      }
      continue
    }
    if (event.type === 'turn/end' && event.data.reason.kind !== 'max-tokens') {
      count = 0
      fromTurns.clear()
    }
  }
  return { count, fromTurns }
}

function latestMaxTokenTurn(events: readonly SessionEvent[]): number | undefined {
  const index = events.findLastIndex(candidate => candidate.type === 'turn/end')
  if (index < 0 || events.slice(index + 1).some(candidate => candidate.type === 'turn/start')) return undefined
  const event = events[index]
  return event?.type === 'turn/end' && event.data.reason.kind === 'max-tokens'
    ? event.data.turn
    : undefined
}

/** Install bounded per-agent automatic continuation. */
export function apply(ctx: Context, config: Config): void {
  const maxContinuations = config.maxContinuations as number
  if (!Number.isInteger(maxContinuations) || maxContinuations < 1) {
    throw new Error('max-token-continuation: `maxContinuations` must be a positive integer')
  }

  const enqueueContinuation = (agent: Agent, turn: number): void => {
    const state = continuationState(agent.session.events)
    if (state.fromTurns.has(turn) || agent.inbox.nextTurn.length > 0) return
    if (state.count >= maxContinuations) return
    const ordinal = state.count + 1
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: CONTINUATION_PROMPT }],
      source: {
        kind: 'plugin',
        plugin: name,
        form: 'notice',
        summary: `Output limit reached; automatically continuing (${ordinal}/${maxContinuations})`,
        cause: 'max-tokens',
        fromTurn: turn,
        ordinal,
        limit: maxContinuations,
      } as unknown as ContinuationSource,
    }))
  }

  // A resumed session may have persisted turn/end before the prior followup
  // was claimed. Recreate that pending work once, while preserving callers.
  ctx.on('agent/session-start', ({ agent, source }): void => {
    if (source !== 'resume') return
    const turn = latestMaxTokenTurn(agent.session.events)
    if (turn !== undefined) enqueueContinuation(agent, turn)
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }): void => {
    if (!latestStepReachedMaxTokens(agent.session.events, turn)) return

    enqueueContinuation(agent, turn)
  })
}
