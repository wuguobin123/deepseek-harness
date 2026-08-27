/**
 * Chat message list.
 *
 * Re-implements webUI's `<ChatMessageList>` occupant of
 * `conversation.chat.body`. Renders the event stream from
 * `ctx.conversation.listEvents(sessionId)`. Each event is rendered by
 * the registered occupants of `conversation.chat.message-row`,
 * `conversation.chat.tool-call-row`, `conversation.chat.feedback-row`,
 * and `conversation.chat.attachment-rail`.
 */
import React from 'react'

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessageEvent {
  id: string
  role: ChatMessageRole
  content: string
  createdAt: number
  toolCallId?: string
  attachments?: Array<{ id: string; name: string; kind: string }>
  status?: 'streaming' | 'done' | 'failed' | 'cancelled'
}

export interface ChatMessageListProps {
  events: ChatMessageEvent[]
  renderUser: (e: ChatMessageEvent) => React.ReactNode
  renderAssistant: (e: ChatMessageEvent) => React.ReactNode
  renderSystem: (e: ChatMessageEvent) => React.ReactNode
  renderTool: (e: ChatMessageEvent) => React.ReactNode
  emptyState: React.ReactNode
}

export function ChatMessageList({
  events,
  renderUser,
  renderAssistant,
  renderSystem,
  renderTool,
  emptyState,
}: ChatMessageListProps): React.JSX.Element {
  if (events.length === 0) return <div className="chat-message-list chat-message-list--empty">{emptyState}</div>
  return (
    <ol className="chat-message-list" data-testid="chat-message-list">
      {events.map((e) => {
        const body = (() => {
          switch (e.role) {
            case 'user': return renderUser(e)
            case 'assistant': return renderAssistant(e)
            case 'tool': return renderTool(e)
            default: return renderSystem(e)
          }
        })()
        return (
          <li
            key={e.id}
            className={`chat-message-list__row chat-message-list__row--${e.role}`}
            data-testid="chat-message-row"
            data-event-id={e.id}
            data-role={e.role}
            data-status={e.status ?? 'done'}
          >
            {body}
          </li>
        )
      })}
    </ol>
  )
}
