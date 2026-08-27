/**
 * No-session hero.
 *
 * Re-implements webUI's `<NoSessionHero>` occupant of
 * `conversation.hero`. Shown when the workspace is selected but no
 * session is active yet. Mirrors the legacy `HomePanel` surface but
 * scoped to the conversation view (no sidebar / settings chrome).
 */
import React from 'react'
import { Brand } from '../brand/Brand'
import { SkillChips, type SkillChip } from '../skill/SkillChips'

export interface NoSessionHeroProps {
  workspaceLabel: string | null
  prompt: string
  skillChips: SkillChip[]
  onStart: (initialPrompt: string) => void
  onToggleSkill: (id: string) => void
}

export function NoSessionHero({ workspaceLabel, prompt, skillChips, onStart, onToggleSkill }: NoSessionHeroProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(prompt)
  React.useEffect(() => { setDraft(prompt) }, [prompt])
  return (
    <section className="no-session-hero" data-testid="no-session-hero">
      <Brand />
      <h1 className="no-session-hero__title">
        {workspaceLabel ? `在 ${workspaceLabel} 中开始一个新会话` : '开启新会话'}
      </h1>
      <div className="no-session-hero__composer" data-testid="no-session-composer">
        <textarea
          className="no-session-hero__textarea"
          value={draft}
          onChange={(e) =>{  setDraft(e.target.value) }}
          placeholder="描述你想让 AI 做什么…"
          data-testid="no-session-input"
        />
        <button
          type="button"
          className="primary"
          onClick={() =>{  onStart(draft) }}
          disabled={!draft.trim()}
          data-testid="no-session-submit"
        >
          开始
        </button>
      </div>
      <SkillChips skills={skillChips} onToggle={onToggleSkill} />
    </section>
  )
}
