/** Browser plugin that contributes account business Skill controls to Settings. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BusinessSkillsSettingsTab,
  type BusinessSkillView,
  type BusinessSkillsSettingsTabInjected,
} from './BusinessSkillsSettingsTab.tsx'
import { en, zh, type BusinessSkillsLocaleKey } from './locales.ts'

export type {
  BusinessSkillView,
  BusinessSkillsSettingsTabInjected,
  BusinessSkillsSettingsTabProps,
} from './BusinessSkillsSettingsTab.tsx'
export type { BusinessSkillsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Business Skill Settings copy. */ 'settings.businessSkills': BusinessSkillsLocaleKey }
}

/** Locale namespace contributed by the business Skill Settings tab. */
export const NS = 'settings.businessSkills'
export const inject = ['slots', 'locale', 'connection']

type ApiResult<T> = { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }

/** Contribute the authenticated business Skill management tab. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-business-skills: dictionaries')
  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const api = connection.api.businessSkills
  const unwrap = async <T>(request: Promise<ApiResult<T>>): Promise<T> => {
    const response = await request
    if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
    return response.result.value
  }
  const injected = (): BusinessSkillsSettingsTabInjected => ({
    list: async () => {
      const versions = (await unwrap(api.list({}))).items
      const current = new Map<string, BusinessSkillView>()
      for (const version of versions) {
        const item = current.get(version.manifest.name)
        if (item !== undefined && (item.enabled || (!version.active && item.revision > version.revision))) continue
        current.set(version.manifest.name, {
          skillId: version.manifest.name,
          title: version.manifest.description,
          activeVersion: version.manifest.version,
          revision: version.revision,
          enabled: version.active,
        })
      }
      return [...current.values()]
    },
    validate: async manifestText => unwrap(api.validate({ manifestText })),
    publish: async (manifestText, expectedRevision) => {
      await unwrap(api.publish({
        manifestText,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }))
    },
    disable: async (skillId, expectedRevision) => { await unwrap(api.disable({ skill: skillId, expectedRevision })) },
    rollback: async (skillId, targetVersion, expectedRevision) => {
      const versions = (await unwrap(api.list({}))).items
      const target = versions.find(version => (
        version.manifest.name === skillId && version.manifest.version === targetVersion
      ))
      if (target === undefined) throw new Error(`unknown business Skill version: ${targetVersion}`)
      await unwrap(api.rollback({ skill: skillId, revision: target.revision, expectedRevision }))
    },
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'business-skills',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, BusinessSkillsSettingsTab))
}
