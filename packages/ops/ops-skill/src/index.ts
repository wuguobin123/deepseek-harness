/**
 * `@deepseek-ai/dsh-ops-skill` — bundled Skill provider for the ops product.
 *
 * Scans `packages/ops/ops-skill/skills/<name>/SKILL.md` and registers each
 * entry on `ctx.skills` under the `ops-skill` provider name. Scenarios are
 * added one at a time by dropping a directory under `skills/` that satisfies
 * the scenario contract; this provider re-reads entries on every `skill(name)`
 * load so frontmatter and body edits take effect without restart.
 *
 * @module @deepseek-ai/dsh-ops-skill
 */

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'

const PROVIDER_NAME = 'ops-skill'
const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

/** Provider-owned locator: the scenario directory name relative to `skills/`. */
interface OpsSkillLocator {
  readonly directory: string
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.end) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; end: number } | undefined {
  let lineStart = start
  while (lineStart < raw.length) {
    const next = raw.indexOf('\n', lineStart)
    const line = next < 0 ? raw.slice(lineStart) : raw.slice(lineStart, next)
    if (line.replace(/\r$/, '') === '---') {
      return { start, end: next < 0 ? raw.length : next + 1 }
    }
    if (next < 0) return undefined
    lineStart = next + 1
  }
  return undefined
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean {
  const raw = data[key]
  if (raw === undefined) return true
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase()
    if (lower === 'true' || lower === 'yes' || lower === 'on' || lower === '1') return true
    if (lower === 'false' || lower === 'no' || lower === 'off' || lower === '0') return false
  }
  throw new TypeError(`ops-skill: frontmatter field "${key}" must be a boolean; got ${JSON.stringify(raw)}`)
}

const createOpsSkillProvider = (): SkillProvider => ({
  name: PROVIDER_NAME,

  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    const candidates: SkillCandidate[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'README.md' || entry.name.startsWith('.')) continue
      const dirPath = join(SKILLS_DIR, entry.name)
      const filePath = join(dirPath, 'SKILL.md')
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      } catch {
        continue
      }
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue
      const data = parsed.data
      const name = data.name
      const description = data.description
      if (typeof name !== 'string' || typeof description !== 'string') continue
      let modelInvocable: boolean
      let userInvocable: boolean
      try {
        modelInvocable = !frontmatterBoolean(data, 'disable-model-invocation')
        userInvocable = frontmatterBoolean(data, 'user-invocable')
      } catch {
        continue
      }
      const metadata = extractMetadata(data)
      const candidate: SkillCandidate = {
        name,
        description,
        invocation: { modelInvocable, userInvocable },
        source: 'bundled',
        provider: PROVIDER_NAME,
        rank: BUNDLED_SKILL_RANK,
        locator: { directory: entry.name } satisfies OpsSkillLocator,
        path: filePath,
        ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}),
        ...(metadata ? { metadata } : {}),
      }
      candidates.push(candidate)
    }
    return candidates
  },

  async get(candidate, _options): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as OpsSkillLocator
    const dirName = locator.directory
    const filePath = join(SKILLS_DIR, dirName, 'SKILL.md')
    const raw = await readFile(filePath, 'utf8')
    const parsed = parseFrontmatter(raw)
    if (!parsed) return undefined
    const data = parsed.data
    const name = data.name
    const description = data.description
    if (typeof name !== 'string' || typeof description !== 'string') return undefined
    const modelInvocable = !frontmatterBoolean(data, 'disable-model-invocation')
    const userInvocable = frontmatterBoolean(data, 'user-invocable')
    const metadata = extractMetadata(data)
    const definition: SkillDefinition = {
      name,
      description,
      invocation: { modelInvocable, userInvocable },
      source: 'bundled',
      provider: PROVIDER_NAME,
      content: parsed.body,
      path: filePath,
      resourceBase: { kind: 'directory', path: join(SKILLS_DIR, dirName) },
      ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}),
      ...(metadata ? { metadata } : {}),
    }
    return definition
  },
})

function extractMetadata(data: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  const meta = data.metadata
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  return meta as Record<string, unknown>
}

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-skill'
/** Service required by this plugin. */
export const inject = ['skills']
/** Provider config; today no fields are configurable. */
export interface Config {}

/**
 * Register the bundled Skill provider on `ctx.skills`.
 * @param ctx - Cordis context carrying the Skill registry.
 * @returns the provider's disposer; the registry owns disposal order.
 */
export const apply = (ctx: Context): (() => void) => ctx.skills.registerProvider(createOpsSkillProvider)
