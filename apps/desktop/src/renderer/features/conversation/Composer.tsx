/**
 * Composer.
 *
 * Re-implements webUI's `<Composer>` occupant of
 * `conversation.input.composer`. Captures user input, attachments,
 * model selection, plan-mode toggle, and dispatches through
 * `ctx.conversation.submit(...)`. Slots docked around the textarea
 * (`conversation.composer.dock.<id>`) are rendered as children.
 */
import React from 'react'
import { ModelSelectionPicker, type ModelOption } from '../model-selection/ModelSelectionPicker'

export interface ComposerProps {
  draft: string
  onDraftChange: (next: string) => void
  onSubmit: () => void
  onAttach: () => void
  onOpenCommands: () => void
  onOpenInputTriggers: () => void
  busy: boolean
  planModeEnabled: boolean
  onTogglePlanMode: () => void
  modelOptions: ModelOption[]
  selectedModelId: string | null
  onSelectModel: (id: string) => void
  docked: React.ReactNode
}

export function Composer({
  draft, onDraftChange, onSubmit, onAttach, onOpenCommands, onOpenInputTriggers,
  busy, planModeEnabled, onTogglePlanMode,
  modelOptions, selectedModelId, onSelectModel,
  docked,
}: ComposerProps): React.JSX.Element {
  return (
    <section className="composer" data-testid="composer">
      <textarea
        className="composer__textarea"
        value={draft}
        onChange={(e) =>{  onDraftChange(e.target.value) }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="向助手发送消息… (⌘ + Enter)"
        data-testid="composer-input"
        disabled={busy}
      />
      <footer className="composer__footer" data-testid="composer-footer">
        <div className="composer__dock" data-testid="composer-dock">{docked}</div>
        <div className="composer__actions" data-testid="composer-actions">
          <button
            type="button"
            className={`ghost ${planModeEnabled ? 'is-active' : ''}`}
            data-testid="composer-plan-toggle"
            aria-pressed={planModeEnabled}
            onClick={onTogglePlanMode}
          >
            计划模式
          </button>
          <ModelSelectionPicker
            options={modelOptions}
            selectedId={selectedModelId}
            onSelect={onSelectModel}
          />
          <button type="button" className="ghost" data-testid="composer-attach" onClick={onAttach}>📎</button>
          <button type="button" className="ghost" data-testid="composer-triggers" onClick={onOpenInputTriggers}>/ @</button>
          <button type="button" className="ghost" data-testid="composer-commands" onClick={onOpenCommands}>⌘K</button>
          <button
            type="button"
            className="primary"
            onClick={onSubmit}
            disabled={busy || !draft.trim()}
            data-testid="composer-submit"
          >
            {busy ? '发送中…' : '发送'}
          </button>
        </div>
      </footer>
    </section>
  )
}
