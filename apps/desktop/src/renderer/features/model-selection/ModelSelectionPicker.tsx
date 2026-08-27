/**
 * Per-conversation model selection picker.
 *
 * Re-implements webUI's `<ModelSelectionPicker>` occupant of
 * `conversation.input.model`. Lists models from
 * `ctx.modelSelection.list()`; selecting one posts through
 * `ctx.modelSelection.select(modelId)`.
 */

export interface ModelOption {
  id: string
  displayName: string
  provider: string
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface ModelSelectionPickerProps {
  options: ModelOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChangeEffort?: (effort: 'low' | 'medium' | 'high') => void
  effort?: 'low' | 'medium' | 'high'
}

export function ModelSelectionPicker({
  options,
  selectedId,
  onSelect,
  onChangeEffort,
  effort,
}: ModelSelectionPickerProps): React.JSX.Element {
  const selected = options.find(o => o.id === selectedId)
  return (
    <div className="model-selection-picker" data-testid="model-selection-picker">
      <select
        className="model-selection-picker__select"
        value={selectedId ?? ''}
        onChange={(e) =>{  onSelect(e.target.value) }}
        data-testid="model-selection-select"
      >
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.displayName} ({o.provider})
          </option>
        ))}
      </select>
      {onChangeEffort && selected?.reasoningEffort !== undefined ? (
        <select
          className="model-selection-picker__effort"
          value={effort ?? selected.reasoningEffort}
          onChange={(e) =>{  onChangeEffort(e.target.value as 'low' | 'medium' | 'high') }}
          data-testid="model-selection-effort"
          aria-label="推理深度"
        >
          <option value="low">轻量</option>
          <option value="medium">平衡</option>
          <option value="high">深度</option>
        </select>
      ) : null}
    </div>
  )
}
