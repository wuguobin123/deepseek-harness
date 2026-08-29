import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SkillManagementApi } from './SkillManagementSection'
import { SkillManagementSection } from './SkillManagementSection'

/**
 * Register the desktop-only local Skill settings page.
 *
 * @param ctx - Desktop renderer context that owns the settings slots.
 * @param api - Native no-path Skill inventory and directory-picker bridge.
 */
export function apply(ctx: ClientContext, api: SkillManagementApi): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 20,
    label: '技能',
    inject: () => ({ api }),
  }, SkillManagementSection))
}

export type { SkillManagementApi } from './SkillManagementSection'
export { SkillManagementSection } from './SkillManagementSection'
