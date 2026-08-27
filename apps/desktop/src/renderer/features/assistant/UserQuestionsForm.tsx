/**
 * User questions composer-takeover form.
 *
 * Mirrors the webUI's `<UserQuestionsForm />` shape: one `<fieldset>` per
 * question, one radio option per choice, gated submit. Each question
 * surfaces its `header` (the short label shown above the question) and
 * `description` (the longer tooltip-style explanation under each option).
 *
 * Submission collects `{ [questionId]: selectedOptionLabel }` and forwards
 * to `onSubmit`, which the parent wires to `api.respond(callId, answers)`.
 */
import React from 'react'
import type { UserQuestionsRequest } from './types'

interface UserQuestionsFormProps {
  request: UserQuestionsRequest
  onSubmit: (answers: Record<string, string>) => void
}

export function UserQuestionsForm({ request, onSubmit }: UserQuestionsFormProps): React.JSX.Element {
  const [answers, setAnswers] = React.useState<Record<string, string>>({})

  const allAnswered = request.questions.every(q => Boolean(answers[q.id]))

  const onPick = React.useCallback((questionId: string, label: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: label }))
  }, [])

  const onFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!allAnswered) return
      onSubmit(answers)
    },
    [allAnswered, answers, onSubmit],
  )

  return (
    <form
      className="user-questions-form"
      data-testid="assistant-user-questions"
      onSubmit={onFormSubmit}
    >
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
          <fieldset key={q.id} className="user-questions-form__question">
            {q.header ? (
              <legend className="user-questions-form__legend">{q.header}</legend>
            ) : null}
            <p className="user-questions-form__prompt">{q.question}</p>
            <div className="user-questions-form__options" role="radiogroup" aria-label={q.question}>
              {q.options.map((opt) => {
                const id = `${q.id}-${opt.label}`
                const checked = answers[q.id] === opt.label
                return (
                  <label
                    key={opt.label}
                    htmlFor={id}
                    className={`user-questions-form__option ${checked ? 'is-checked' : ''}`}
                  >
                    <input
                      id={id}
                      type="radio"
                      name={q.id}
                      value={opt.label}
                      checked={checked}
                      onChange={() =>{  onPick(q.id, opt.label) }}
                    />
                    <span className="user-questions-form__option-label">{opt.label}</span>
                    {opt.description ? (
                      <span className="user-questions-form__option-desc">{opt.description}</span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="user-questions-form__actions">
        <button
          type="submit"
          className="primary"
          disabled={!allAnswered}
          data-testid="assistant-user-questions-submit"
        >
          提交回答
        </button>
      </div>
    </form>
  )
}
