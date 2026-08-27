/**
 * Input trigger picker — `/` commands and `@` references.
 *
 * Re-implements webUI's `<InputTriggerMenu>` occupant of
 * `conversation.composer.dock`. Listens to the textarea value; when the
 * caret follows a `/` or `@` token, opens a candidate list sourced from
 * `ctx.inputTriggers.candidates(token)`.
 */
import React from 'react'

export type InputTriggerKind = 'command' | 'reference' | 'skill' | 'mention'

export interface InputTriggerCandidate {
  id: string
  label: string
  description?: string
  icon?: string
  insertText: string
}

export interface InputTriggerMenuProps {
  active: boolean
  kind: InputTriggerKind | null
  candidates: InputTriggerCandidate[]
  onPick: (candidate: InputTriggerCandidate) => void
  onClose: () => void
}

export function InputTriggerMenu({ active, kind, candidates, onPick, onClose }: InputTriggerMenuProps): React.JSX.Element | null {
  const [activeIndex, setActiveIndex] = React.useState(0)

  React.useEffect(() => { setActiveIndex(0) }, [candidates])

  if (!active || !kind || candidates.length === 0) return null

  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown') { setActiveIndex(i => Math.min(candidates.length - 1, i + 1)); event.preventDefault() }
    else if (event.key === 'ArrowUp') { setActiveIndex(i => Math.max(0, i - 1)); event.preventDefault() }
    else if (event.key === 'Escape') { onClose(); event.preventDefault() }
    else if (event.key === 'Enter' && candidates[activeIndex]) { onPick(candidates[activeIndex]); event.preventDefault() }
  }

  return (
    <ul
      className={`input-trigger-menu input-trigger-menu--${kind}`}
      data-testid="input-trigger-menu"
      data-trigger-kind={kind}
      role="listbox"
      onKeyDown={onListKeyDown}
    >
      {candidates.map((c, i) => (
        <li
          key={c.id}
          className={`input-trigger-menu__item ${i === activeIndex ? 'is-active' : ''}`}
          data-testid="input-trigger-menu-item"
          data-candidate-id={c.id}
          data-active={i === activeIndex}
          onMouseEnter={() =>{  setActiveIndex(i) }}
          onClick={() =>{  onPick(c) }}
        >
          <span className="input-trigger-menu__icon" aria-hidden="true">{c.icon ?? (kind === 'command' ? '/' : '@')}</span>
          <span className="input-trigger-menu__label">{c.label}</span>
          {c.description ? <span className="input-trigger-menu__desc">{c.description}</span> : null}
        </li>
      ))}
    </ul>
  )
}
