/**
 * Assistant view — one session at a time.
 *
 * Mounts the Mux subscription for the URL's `:sessionId` and renders the
 * running turn. The user types into a single textarea; submission posts
 * `session.prompt` and the assistant stream is folded into the message
 * list by `AssistantContext`.
 */
import React from 'react'
import { useParams } from 'react-router-dom'
import { useAssistant } from './AssistantContext'
import { MarkdownContent } from './MarkdownContent'

export function AssistantPage(): React.JSX.Element {
  const { sessionId = '' } = useParams<{ sessionId: string }>()
  const { state, prompt, cancel, attachSession } = useAssistant()
  const [draft, setDraft] = React.useState('')
  const [attachError, setAttachError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!sessionId) return
    let active = true
    void attachSession(sessionId).catch((err: unknown) => {
      if (active) setAttachError((err as Error).message)
    })
    return () => {
      active = false
    }
  }, [attachSession, sessionId])

  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages])

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const content = draft.trim()
      if (!content || state.running) return
      setDraft('')
      try {
        await prompt(content)
      } catch {
        // surfaced via the assistant/error reducer path
      }
    },
    [draft, prompt, state.running],
  )

  return (
    <section className="page page-assistant" data-testid="page-assistant">
      <header className="page-assistant__header">
        <h1>会话 {sessionId.slice(0, 8)}</h1>
        <span className={`page-assistant__status ${state.running ? 'is-running' : ''}`} data-testid="assistant-status">
          {state.running ? '运行中…' : '空闲'}
        </span>
      </header>
      {attachError ? (
        <p className="page-assistant__error" role="alert" data-testid="assistant-attach-error">
          {attachError}
        </p>
      ) : null}
      <div className="assistant-thread" ref={scrollRef} data-testid="assistant-thread">
        {state.messages.length === 0 ? (
          <p className="assistant-thread__empty">向助手发一条消息开始本次会话。</p>
        ) : (
          state.messages.map(m => (
            <article key={m.id} className={`assistant-message assistant-message--${m.role}`} data-testid="assistant-message" data-role={m.role}>
              {m.role === 'assistant' ? (
                m.text ? (
                  <MarkdownContent>{m.text}</MarkdownContent>
                ) : (
                  <span className="assistant-message__placeholder">{m.error ? `出错了：${m.error}` : '思考中…'}</span>
                )
              ) : (
                <p className="assistant-message__user">{m.text}</p>
              )}
            </article>
          ))
        )}
      </div>
      <form className="assistant-composer" onSubmit={(event) => { void onSubmit(event) }} data-testid="assistant-composer">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) =>{  setDraft(e.target.value) }}
          placeholder={state.running ? '正在等待上一次回复…' : '向助手提问…'}
          disabled={state.running}
          data-testid="assistant-input"
        />
        <div className="assistant-composer__actions">
          {state.running ? (
            <button type="button" onClick={() => void cancel()} data-testid="assistant-cancel">
              取消
            </button>
          ) : null}
          <button type="submit" className="primary" disabled={!draft.trim() || state.running} data-testid="assistant-send">
            发送
          </button>
        </div>
      </form>
    </section>
  )
}
