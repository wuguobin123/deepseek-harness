/**
 * Home panel — entry surface that bridges `ui-workspace` and
 * `ui-conversation` into the legacy desktop sidebar slot.
 *
 * Re-implements webUI's `<HomeHero>` (occupant of
 * `conversation.hero.home`) and replaces the legacy `HomePage`. The
 * legacy page routed through `react-router-dom` to `/#/`, so this
 * surface is rendered when no session id is present in the URL hash.
 */
import React from 'react'
import { Brand } from '../brand/Brand'
import { SkillChips, type SkillChip } from '../skill/SkillChips'

export interface HomePanelProps {
  greeting: string
  prompt: string
  skillChips: SkillChip[]
  onStartSession: (initialPrompt: string) => void
  onToggleSkill: (id: string) => void
  onPickPrompt: (prompt: string) => void
}

export function HomePanel({
  greeting,
  prompt,
  skillChips,
  onStartSession,
  onToggleSkill,
  onPickPrompt,
}: HomePanelProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(prompt)
  React.useEffect(() => { setDraft(prompt) }, [prompt])
  return (
    <section className="home-panel" data-testid="home-panel">
      <header className="home-panel__header">
        <Brand />
        <h1 className="home-panel__greeting">{greeting}</h1>
      </header>
      <div className="home-panel__composer" data-testid="home-composer">
        <textarea
          className="home-panel__textarea"
          value={draft}
          onChange={(e) =>{  setDraft(e.target.value) }}
          placeholder="描述你想让 AI 做什么…"
          data-testid="home-composer-input"
        />
        <button
          type="button"
          className="primary"
          onClick={() =>{  onStartSession(draft) }}
          disabled={!draft.trim()}
          data-testid="home-composer-submit"
        >
          开启会话
        </button>
      </div>
      <SkillChips skills={skillChips} onToggle={onToggleSkill} />
      <ul className="home-panel__prompts" data-testid="home-prompts">
        {['阅读并总结仓库', '重构模块', '撰写单元测试'].map(p => (
          <li key={p}>
            <button
              type="button"
              className="ghost"
              data-testid="home-prompt"
              data-prompt={p}
              onClick={() =>{  onPickPrompt(p) }}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
