import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '@deepseek-ai/dsh-client-ui-theme'

function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('ui-theme host', () => {
  it('injects the fixed light bootstrap until disposal', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    const rows = collect(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(scriptText(rows[0])).toContain('const preference = "light"')

    await fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })

  it('ignores legacy Host theme settings', async () => {
    const ctx = new Context()
    ctx.provide('settings', { get: () => ({ preference: 'dark' }) } as never)
    await ctx.plugin({ apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "light"')
  })
})
