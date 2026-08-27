/** Model-facing installer for account-private skills. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-account-skill-store'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isSkillName } from '@deepseek-ai/dsh-skill'

interface SkillInstallInput { name: string; description: string; instructions: string }

/** Cordis plugin name. */
export const name = 'tool-skill-install'
/** Required service dependencies. */
export const inject = ['tools', 'skills', 'accountSkillStore']

/** Register the `skill_install` tool. Owner identity is always taken from the session header. */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'skill_install') return await next()
    if (exec.agent?.session.header.origin === 'subagent') {
      return { kind: 'deny', reason: 'a subagent cannot install account skills' }
    }
    if (exec.agent?.session.header.ownerId === undefined) {
      return { kind: 'deny', reason: 'account owner is required' }
    }
    return {
      kind: 'ask',
      reason: 'Install the proposed Skill in the signed-in account\'s private Skill directory.',
    }
  })
  ctx.tools.register(defineTool({
    name: 'skill_install',
    description: 'Install a private skill for the current account.',
    parameters: {
      name: { type: 'string', required: true, description: 'Kebab-case skill name.' },
      description: { type: 'string', required: true, description: 'Short skill description.' },
      instructions: { type: 'string', required: true, description: 'Markdown instructions.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', required: true }, changed: { type: 'boolean', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: `${value.changed ? 'Installed' : 'Already installed'} skill ${value.name}` }] },
    async execute(args: SkillInstallInput, exec) {
      if (!isSkillName(args.name)) throw new Error('invalid skill name')
      if (exec.agent?.session.header.origin === 'subagent') throw new Error('a subagent cannot install account skills')
      const ownerId = exec.agent?.session.header.ownerId
      if (ownerId === undefined) throw new Error('account owner is required')
      const result = await ctx.accountSkillStore.install(ownerId, args)
      if (result.changed) ctx.skills.refresh()
      return { name: result.name, changed: result.changed }
    },
    presentCall: args => ({ card: 'generic', title: `Install skill ${args.name}`, kind: 'edit', rawInput: args.name }),
  }))
}
