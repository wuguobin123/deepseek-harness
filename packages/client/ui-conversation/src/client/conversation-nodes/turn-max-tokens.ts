import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition, TurnMaxTokensNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isMaxTokenContinuationSource } from '@deepseek-ai/dsh-client-runtime/client'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Turn ended by the per-request output-token cap. */
    'turn-max-tokens': TurnMaxTokensNode
  }
}

interface TurnMaxTokensState {
  readonly turn: number
  readonly seq: number
  readonly time: number
  readonly ordinal?: number
  readonly limit?: number
}

function lastStep(context: ConversationNodeContext<TurnMaxTokensState>): number {
  const location = context.start?.location ?? context.matches[0]?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return 0
  return location.turn.steps.at(-1)?.step ?? 0
}

/**
 * Anchor the notice between the closing Assistant and the turn-tail so the
 * tail stays the turn's last Chat node and keeps its branch action enabled.
 * Without a closing text Assistant there is no branch action to protect, and
 * the turn/end seq keeps the notice at the truncation point.
 */
function noticeAnchor(context: ConversationNodeContext<TurnMaxTokensState>, seq: number): number {
  const location = context.start?.location ?? context.matches[0]?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return seq
  const closing = location.turn.data.get('turn-tail')?.closing
  return closing === null || closing === undefined
    ? seq
    : closing.finalNode.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.maxTokensNotice
}

function stateFrom(match: ConversationMatch): TurnMaxTokensState | undefined {
  if (match.event.type === 'turn/end' && match.event.data.reason.kind === 'max-tokens') {
    return { turn: match.event.data.turn, seq: match.event.seq, time: match.event.time }
  }
  if (match.event.type !== 'user/message') return undefined
  const source = match.event.data.source
  if (!isMaxTokenContinuationSource(source)) return undefined
  return {
    turn: source.fromTurn, seq: match.event.seq, time: match.event.time,
    ordinal: source.ordinal, limit: source.limit,
  }
}

/** Notice Definition for a turn the provider ended at its output-token cap. */
export const turnMaxTokensDefinition: ConversationNodeDefinition<TurnMaxTokensState> = {
  kind: 'turn-max-tokens',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/end' && event.data.reason.kind === 'max-tokens') {
      return { id: String(event.data.turn), role: 'start' }
    }
    if (event.type === 'user/message') {
      const source = event.data.source
      if (isMaxTokenContinuationSource(source)) return { id: String(source.fromTurn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    const state = stateFrom(match)
    if (state === undefined) throw new Error('turn-max-tokens start requires a max-tokens turn/end')
    return state
  },
  update: (context, match) => {
    const next = stateFrom(match)
    if (next === undefined) return context.state
    return {
      ...context.state,
      ...(match.event.type === 'turn/end' ? { seq: next.seq, time: next.time } : {}),
      ...(next.ordinal === undefined ? {} : { ordinal: next.ordinal, limit: next.limit }),
    }
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const node: TurnMaxTokensNode = {
      kind: 'turn-max-tokens',
      seq: state.seq,
      time: state.time,
      turn: state.turn,
      step: lastStep(context),
      ...(state.ordinal === undefined || state.limit === undefined
        ? {} : { continuation: { ordinal: state.ordinal, limit: state.limit } }),
    }
    return chatNode(context, 'turn-max-tokens', noticeAnchor(context, state.seq), node)
  },
}

/**
 * Register the max-tokens turn-end notice contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnMaxTokensConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(turnMaxTokensDefinition)
}
