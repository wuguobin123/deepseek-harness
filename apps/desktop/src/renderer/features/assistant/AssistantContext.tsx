/**
 * Assistant context — owns the per-session turn state and listens to
 * /api/events.mux for the active session.
 *
 * Wire flow:
 *   renderer  →  api.session.prompt(...)  →  POST /api/session.prompt
 *   host      →  SSE MuxFrames
 *                  - session/event (kind=assistant/text-delta, etc.)
 *                  - session/subscribed (initial replay marker)
 *                  - stream/error
 *
 * The reducer accumulates `assistant/text-delta` events into a single
 * in-progress assistant message; the next turn starts a fresh message.
 */
import React from 'react'
import * as api from '../../api'
import type { AssistantTurnState, Message } from './types'

const AssistantContext = React.createContext<{
  state: AssistantTurnState
  prompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
} | null>(null)

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

function isAssistantTextDelta(event: unknown): event is { delta: string; messageId?: string } {
  if (!event || typeof event !== 'object') return false
  const e = event as { type?: unknown; delta?: unknown }
  return e.type === 'assistant/text-delta' && typeof e.delta === 'string'
}

function reducer(state: AssistantTurnState, action: { type: 'reset'; sessionId: string } | { type: 'user'; message: Message } | { type: 'delta'; messageId?: string; delta: string } | { type: 'final'; messageId?: string } | { type: 'error'; messageId?: string; error: string } | { type: 'running'; running: boolean }): AssistantTurnState {
  switch (action.type) {
    case 'reset':
      return { sessionId: action.sessionId, running: false, messages: [] }
    case 'user':
      return { ...state, messages: [...state.messages, action.message] }
    case 'delta': {
      const last = state.messages.at(-1)
      if (last !== undefined && last.role === 'assistant' && !last.final) {
        const updated: Message = { ...last, text: last.text + action.delta }
        return { ...state, messages: [...state.messages.slice(0, -1), updated] }
      }
      const next: Message = {
        id: action.messageId ?? newId(),
        role: 'assistant',
        text: action.delta,
      }
      return { ...state, messages: [...state.messages, next] }
    }
    case 'final': {
      const messages = state.messages.map(m =>
        m.role === 'assistant' && !m.final ? { ...m, final: true } : m,
      )
      return { ...state, running: false, messages }
    }
    case 'error': {
      const last = state.messages.at(-1)
      if (last !== undefined && last.role === 'assistant' && !last.final) {
        const updated: Message = { ...last, final: true, error: action.error }
        return { ...state, running: false, messages: [...state.messages.slice(0, -1), updated] }
      }
      return {
        ...state,
        running: false,
        messages: [
          ...state.messages,
          { id: newId(), role: 'assistant', text: '', final: true, error: action.error },
        ],
      }
    }
    case 'running':
      return { ...state, running: action.running }
    default:
      return state
  }
}

export function AssistantProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, dispatch] = React.useReducer(reducer, { sessionId: '', running: false, messages: [] })
  const sessionIdRef = React.useRef<string>('')
  const unsubscribeRef = React.useRef<(() => Promise<void>) | null>(null)

  const ensureSubscribed = React.useCallback(async (sessionId: string): Promise<void> => {
    if (unsubscribeRef.current) {
      await unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    sessionIdRef.current = sessionId
    dispatch({ type: 'reset', sessionId })
    const unsub = await api.subscribeMux((envelope) => {
      const frame = envelope.payload
      switch (frame.type) {
        case 'session/event': {
          if (frame.sessionId !== sessionIdRef.current) return
          const event = frame.event as { type?: string; delta?: string; messageId?: string; message_id?: string }
          if (isAssistantTextDelta(event)) {
            dispatch({ type: 'delta', messageId: event.messageId, delta: event.delta })
          } else if (event.type === 'assistant/turn-final' || event.type === 'assistant/final') {
            dispatch({ type: 'final' })
          } else if (event.type === 'assistant/error' || event.type === 'error') {
            const message = (event as { message?: string; error?: string }).message ?? (event as { error?: string }).error ?? 'unknown error'
            dispatch({ type: 'error', error: message })
          }
          return
        }
        case 'session/subscribed':
          return
        case 'stream/error':
          dispatch({ type: 'error', error: frame.error.message })
          return
        default:
          return
      }
    })
    unsubscribeRef.current = unsub
  }, [])

  React.useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        void unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  const prompt = React.useCallback(
    async (content: string) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) {
        throw new Error('no active session')
      }
      dispatch({ type: 'user', message: { id: newId(), role: 'user', text: content } })
      dispatch({ type: 'running', running: true })
      try {
        // session.prompt accepts ContentBlock[] (`packages/host/apiproxy/src/api/sessions.schema.ts:283`).
        // The renderer is text-only in v1, so each user turn is one `text` part.
        await api.session.prompt({
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: content }],
        })
      } catch (err) {
        dispatch({ type: 'error', error: (err as Error).message })
      }
    },
    [],
  )

  const cancel = React.useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await api.session.cancel({ sessionId })
      dispatch({ type: 'final' })
    } catch (err) {
      dispatch({ type: 'error', error: (err as Error).message })
    }
  }, [])

  // Provide a binding from sessionId to ensureSubscribed so AssistantPage can call it
  const apiRef = React.useMemo(() => ({ state, prompt, cancel, ensureSubscribed }), [state, prompt, cancel, ensureSubscribed])

  return (
    <AssistantContext.Provider value={apiRef}>
      <AssistantBridge ensureSubscribed={ensureSubscribed} />
      {children}
    </AssistantContext.Provider>
  )
}

/**
 * Sub-component used only to expose `ensureSubscribed` outside the context.
 * AssistantPage calls `useAssistant().attachSession(id)` on mount.
 */
function AssistantBridge({ ensureSubscribed }: { ensureSubscribed: (sessionId: string) => Promise<void> }): null {
  const ctx = React.useContext(AssistantContext)
  if (ctx) {
    (ctx as { ensureSubscribed?: typeof ensureSubscribed }).ensureSubscribed = ensureSubscribed
  }
  return null
}

export function useAssistant(): {
  state: AssistantTurnState
  prompt: (content: string) => Promise<void>
  cancel: () => Promise<void>
  attachSession: (sessionId: string) => Promise<void>
} {
  const ctx = React.useContext(AssistantContext)
  if (!ctx) {
    throw new Error('useAssistant must be used inside AssistantProvider')
  }
  const attach = (ctx as { ensureSubscribed?: (id: string) => Promise<void> }).ensureSubscribed
  return {
    state: ctx.state,
    prompt: ctx.prompt,
    cancel: ctx.cancel,
    attachSession: attach ?? (() => Promise.resolve()),
  }
}
