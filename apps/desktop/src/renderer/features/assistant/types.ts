/**
 * Assistant view types.
 *
 * Each turn renders as a list of `Message` entries. `assistant` messages are
 * built up from successive `assistant/text-delta` MuxFrames (incremental
 * streaming); the reducer collapses them into one final message per turn.
 */

export type Role = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: Role
  text: string
  /** Set when an assistant turn finishes (no more deltas will arrive). */
  final?: boolean
  /** Set when an error aborts the turn. */
  error?: string
}

export interface AssistantTurnState {
  sessionId: string
  running: boolean
  messages: Message[]
}

/** Tool activity row rendered by the assistant fallback surface. */
export interface ToolEvent {
  name: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  input?: unknown
  output?: unknown
  error?: string
}

/** User-question request rendered by the assistant fallback surface. */
export interface UserQuestionsRequest {
  header?: string
  questions: Array<{
    id: string
    header?: string
    question: string
    options: Array<{ label: string; description?: string }>
  }>
}
