// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.

import css from './TrajectoryTurnHeader.module.css'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

const COLUMN_LABELS = ['Input', 'Output', 'Think', 'Time'] as const

export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  turn: number
  t?: TranslateNS<typeof NS> | undefined
}

/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn, t }: TrajectoryTurnHeaderProps) {
  return (
    <div className={css.root}>
      <div className={css.inner}>
        <span className={css.title}>{t ? `轮次 ${turn}` : `Turn ${turn}`}</span>
        <div className={css.columns} aria-hidden="true">
          {COLUMN_LABELS.map(label => (
            <span key={label} className={css.column}>{
              label === 'Input' ? (t?.('common.input') ?? label)
                : label === 'Output' ? (t?.('common.output') ?? label)
                  : label === 'Think' ? (t?.('common.think') ?? label)
                    : (t?.('common.time') ?? label)
            }</span>
          ))}
        </div>
      </div>
    </div>
  )
}
