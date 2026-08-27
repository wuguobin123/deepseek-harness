/**
 * User questions composer takeover.
 *
 * Re-implements webUI's `<UserQuestionsForm>` occupant of
 * `conversation.input.overlay`. When the host emits
 * `user-questions/requested`, the conversation surface swaps the
 * textarea for this form; submission posts back through
 * `ctx.remote.dispatch('user-questions/answer', { callId, answers })`.
 */
import React from 'react'

export interface UserQuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface UserQuestion {
  id: string
  header?: string
  question: string
  options: UserQuestionOption[]
  multiSelect?: boolean
}

export interface UserQuestionsRequest {
  callId: string
  header?: string
  questions: UserQuestion[]
}

export interface UserQuestionsFormProps {
  request: UserQuestionsRequest
  onSubmit: (callId: string, answers: Record<string, string | string[]>) => void
  onCancel?: (callId: string) => void
}

export function UserQuestionsForm({ request, onSubmit, onCancel }: UserQuestionsFormProps): React.JSX.Element {
  const [answers, setAnswers] = React.useState<Record<string, string | string[]>>({})

  const allAnswered = request.questions.every((q) => {
    const a = answers[q.id]
    return q.multiSelect ? Array.isArray(a) && a.length > 0 : Boolean(a)
  })

  const onPick = React.useCallback((q: UserQuestion, label: string) => {
    setAnswers((prev) => {
      const next = { ...prev }
      if (q.multiSelect) {
        const cur = Array.isArray(next[q.id]) ? next[q.id] as string[] : []
        next[q.id] = cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]
      } else {
        next[q.id] = label
      }
      return next
    })
  }, [])

  const onFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!allAnswered) return
      onSubmit(request.callId, answers)
    },
    [allAnswered, answers, onSubmit, request.callId],
  )

  return (
    <form className="user-questions-form" data-testid="user-questions-form" onSubmit={onFormSubmit}>
      {request.header ? (
        <header className="user-questions-form__header">
          <h3 className="user-questions-form__title">{request.header}</h3>
          <p className="user-questions-form__hint">助手需要确认这些选择后才能继续。</p>
        </header>
      ) : (
        <p className="user-questions-form__hint">助手需要确认这些选择后才能继续。</p>
      )}
      <div className="user-questions-form__list">
        {request.questions.map(q => (
          <fieldset key={q.id} className="user-questions-form__question" data-testid="user-questions-question" data-question-id={q.id}>
            {q.header ? <legend className="user-questions-form__legend">{q.header}</legend> : null}
            <p className="user-questions-form__prompt">{q.question}</p>
            <div className="user-questions-form__options" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
              {q.options.map((opt) => {
                const id = `${q.id}-${opt.label}`
                const checked = q.multiSelect
                  ? Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt.label)
                  : answers[q.id] === opt.label
                return (
                  <label
                    key={opt.label}
                    htmlFor={id}
                    className={`user-questions-form__option ${checked ? 'is-checked' : ''}`}
                  >
                    <input
                      id={id}
                      type={q.multiSelect ? 'checkbox' : 'radio'}
                      name={q.id}
                      value={opt.label}
                      checked={checked}
                      onChange={() =>{  onPick(q, opt.label) }}
                    />
                    <span className="user-questions-form__option-label">{opt.label}</span>
                    {opt.description ? (
                      <span className="user-questions-form__option-desc">{opt.description}</span>
                    ) : null}
                    {opt.preview ? (
                      <pre className="user-questions-form__option-preview">{opt.preview}</pre>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="user-questions-form__actions">
        {onCancel ? (
          <button type="button" className="ghost" data-testid="user-questions-cancel" onClick={() =>{  onCancel(request.callId) }}>
            取消
          </button>
        ) : null}
        <button type="submit" className="primary" disabled={!allAnswered} data-testid="user-questions-submit">
          提交回答
        </button>
      </div>
    </form>
  )
}
