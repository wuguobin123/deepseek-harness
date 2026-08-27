import React from 'react'
import { IconSend } from './icons'
import { t } from '../i18n'

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt?: string
}

interface Props {
  conversationId: string | null
  messages: ConversationMessage[]
  onSend?: (text: string) => void
}

const ROLE_LABELS: Record<ConversationMessage['role'], string> = {
  user: '我',
  assistant: 'AI 助手',
  tool: '工具',
}

export function ConversationThread({ conversationId, messages, onSend }: Props): React.JSX.Element {
  const [draft, setDraft] = React.useState('')

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!draft.trim() || !onSend) return
    onSend(draft.trim())
    setDraft('')
  }

  return (
    <section className="conversation" data-testid="conversation">
      <header>
        <strong>{t('anomalies.detail.conversation')}</strong>
        <small>
          {conversationId
            ? `对话 ID：${conversationId}`
            : t('anomalies.detail.noConversation')}
        </small>
      </header>
      <ol className="conversation__thread" data-testid="conversation-thread">
        {messages.length === 0 && (
          <li className="muted" data-testid="conversation-empty">
            {t('anomalies.detail.noConversation')}
          </li>
        )}
        {messages.map((m, idx) => (
          <li
            key={idx}
            className={`conversation__message conversation__message--${m.role}`}
            data-testid={`conversation-message-${m.role}`}
          >
            <span className="role">{ROLE_LABELS[m.role]}</span>
            <span className="content">{m.content}</span>
            {m.createdAt && (
              <small className="muted">
                {new Date(m.createdAt).toLocaleString('zh-CN')}
              </small>
            )}
          </li>
        ))}
      </ol>
      <form onSubmit={handleSubmit} className="conversation__form">
        <input
          type="text"
          value={draft}
          onChange={(e) =>{  setDraft(e.target.value) }}
          placeholder={t('anomalies.detail.placeholder')}
          aria-label={t('anomalies.detail.placeholder')}
          data-testid="conversation-input"
        />
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="conversation-send"
          title={t('tooltip.sendMessage')}
        >
          <IconSend size={13} />
          {t('anomalies.detail.send')}
        </button>
      </form>
    </section>
  )
}
