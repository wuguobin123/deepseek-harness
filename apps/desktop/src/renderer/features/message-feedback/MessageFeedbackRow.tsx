/**
 * Message feedback row (Like / Dislike / Copy).
 *
 * Re-implements webUI's `<MessageFeedbackRow>` occupant of
 * `conversation.chat.assistant-actions`. Each assistant message gets
 * one row below its content; selecting Like / Dislike posts through
 * `ctx.remote.dispatch('message/feedback', { messageId, kind })`.
 */
import React from 'react'

export type FeedbackKind = 'like' | 'dislike' | null

export interface MessageFeedbackRowProps {
  messageId: string
  initial: FeedbackKind
  onSubmit: (messageId: string, kind: Exclude<FeedbackKind, null>) => void
  onCopy?: (messageId: string) => void
}

export function MessageFeedbackRow({ messageId, initial, onSubmit, onCopy }: MessageFeedbackRowProps): React.JSX.Element {
  const [kind, setKind] = React.useState<FeedbackKind>(initial)

  const onPick = React.useCallback((next: Exclude<FeedbackKind, null>) => {
    setKind(next)
    onSubmit(messageId, next)
  }, [messageId, onSubmit])

  return (
    <div className="message-feedback-row" data-testid="message-feedback-row" data-message-id={messageId} data-feedback={kind ?? 'none'}>
      <button
        type="button"
        className={`message-feedback-row__btn ${kind === 'like' ? 'is-active' : ''}`}
        data-testid="message-feedback-like"
        aria-pressed={kind === 'like'}
        onClick={() =>{  onPick('like') }}
      >
        👍 有用
      </button>
      <button
        type="button"
        className={`message-feedback-row__btn ${kind === 'dislike' ? 'is-active' : ''}`}
        data-testid="message-feedback-dislike"
        aria-pressed={kind === 'dislike'}
        onClick={() =>{  onPick('dislike') }}
      >
        👎 没用
      </button>
      {onCopy ? (
        <button
          type="button"
          className="message-feedback-row__btn"
          data-testid="message-feedback-copy"
          onClick={() =>{  onCopy(messageId) }}
        >
          复制
        </button>
      ) : null}
    </div>
  )
}
