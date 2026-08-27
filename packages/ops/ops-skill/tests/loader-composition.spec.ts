import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as OpsSkill from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-ops-skill-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@deepseek-ai/dsh-ops-skill'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@deepseek-ai/dsh-ops-skill', OpsSkill],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('ops-skill real Loader composition', () => {
  it('discovers, loads, and disposes the bundled next-best-action capability', async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const summaries = await loaded.skills.list()
    expect(summaries).toEqual([
      expect.objectContaining({
        name: 'next-best-action',
        provider: 'ops-skill',
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
      }),
    ])
    const definition = await loaded.skills.get('next-best-action')
    expect(definition).toMatchObject({
      name: 'next-best-action',
      metadata: {
        capability_id: 'operations.next_best_action',
        risk_level: 'R1',
        read_only: true,
      },
    })
    expect(definition?.content).toContain('Stay read-only.')

    const entry = [...loaded.loader.entries()]
      .find(candidate => candidate.options.name === '@deepseek-ai/dsh-ops-skill')
    if (entry?.fiber === undefined) throw new Error('ops-skill Loader entry is not active')
    await entry.fiber.dispose()
    expect(await loaded.skills.list()).toEqual([])
  })
})
