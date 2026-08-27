/**
 * Agent preset picker — hero seat selection.
 *
 * Re-implements webUI's `<AgentPresetPicker>` occupant of
 * `conversation.hero.agentPreset`. Lists presets from
 * `ctx.agentPreset.list()`; selecting one updates
 * `ctx.agentPreset.select(id)`.
 */

export interface AgentPresetRow {
  id: string
  name: string
  description?: string
  icon?: string
  selected?: boolean
}

export interface AgentPresetPickerProps {
  presets: AgentPresetRow[]
  onSelect: (id: string) => void
}

export function AgentPresetPicker({ presets, onSelect }: AgentPresetPickerProps): React.JSX.Element {
  const selected = presets.find(p => p.selected) ?? presets[0]
  return (
    <div className="agent-preset-picker" data-testid="agent-preset-picker">
      <span className="agent-preset-picker__label">智能体</span>
      <select
        className="agent-preset-picker__select"
        value={selected.id}
        onChange={(e) =>{  onSelect(e.target.value) }}
        data-testid="agent-preset-select"
      >
        {presets.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}
