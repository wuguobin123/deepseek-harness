/**
 * Command palette (⌘K).
 *
 * Re-implements webUI's `<CommandPalette>` overlay under
 * `shell.overlay`. Lists registered commands from
 * `ctx.commandUi.list()`; selecting one dispatches through
 * `ctx.commandUi.run(commandId, args)`.
 */
import React from 'react'

export interface CommandEntry {
  id: string
  title: string
  description?: string
  shortcut?: string
  group?: string
  icon?: string
}

export interface CommandPaletteProps {
  open: boolean
  commands: CommandEntry[]
  onSelect: (command: CommandEntry) => void
  onClose: () => void
}

export function CommandPalette({ open, commands, onSelect, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.group?.toLowerCase().includes(q),
    )
  }, [commands, query])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { onClose(); return }
    if (event.key === 'ArrowDown') { setActive(i => Math.min(filtered.length - 1, i + 1)); event.preventDefault(); return }
    if (event.key === 'ArrowUp')   { setActive(i => Math.max(0, i - 1)); event.preventDefault(); return }
    if (event.key === 'Enter' && filtered[active]) {
      onSelect(filtered[active])
      event.preventDefault()
    }
  }

  return (
    <div className="command-palette-overlay" data-testid="command-palette" role="dialog" aria-label="命令面板" onKeyDown={onKeyDown}>
      <div className="command-palette">
        <input
          ref={inputRef}
          type="text"
          className="command-palette__input"
          placeholder="搜索命令…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          data-testid="command-palette-input"
        />
        <ul className="command-palette__list" data-testid="command-palette-list">
          {filtered.length === 0 ? (
            <li className="command-palette__empty" data-testid="command-palette-empty">没有匹配的命令</li>
          ) : null}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              className={`command-palette__item ${i === active ? 'is-active' : ''}`}
              data-testid="command-palette-item"
              data-command-id={c.id}
              data-active={i === active}
              onMouseEnter={() =>{  setActive(i) }}
              onClick={() =>{  onSelect(c) }}
            >
              <span className="command-palette__icon" aria-hidden="true">{c.icon ?? '⌘'}</span>
              <span className="command-palette__title">{c.title}</span>
              {c.description ? <span className="command-palette__desc">{c.description}</span> : null}
              {c.shortcut ? <kbd className="command-palette__shortcut">{c.shortcut}</kbd> : null}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="command-palette__scrim"
        aria-label="关闭命令面板"
        data-testid="command-palette-close"
        onClick={onClose}
      />
    </div>
  )
}
