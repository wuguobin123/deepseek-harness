/**
 * Skill chips.
 *
 * Re-implements webUI's `<SkillChips>` registrant of
 * `conversation.composer.dock` (id `skill`) and
 * `settings.skill.item`. Lists the skills attached to the active
 * session / preset; clicking toggles inclusion.
 */

export interface SkillChip {
  id: string
  name: string
  enabled: boolean
}

export interface SkillChipsProps {
  skills: SkillChip[]
  onToggle: (id: string) => void
}

export function SkillChips({ skills, onToggle }: SkillChipsProps): React.JSX.Element {
  return (
    <ul className="skill-chips" data-testid="skill-chips" role="list">
      {skills.map(s => (
        <li key={s.id}>
          <button
            type="button"
            className={`skill-chip ${s.enabled ? 'is-enabled' : ''}`}
            data-testid="skill-chip"
            data-skill-id={s.id}
            data-enabled={s.enabled}
            aria-pressed={s.enabled}
            onClick={() =>{  onToggle(s.id) }}
          >
            <span className="skill-chip__name">{s.name}</span>
            <span className="skill-chip__toggle" aria-hidden="true">{s.enabled ? '●' : '○'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
