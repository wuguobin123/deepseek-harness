import { access, mkdtemp, mkdir, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installLocalSkill } from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as LocalInstaller from '../src/index.ts'

function agent(origin?: 'subagent'): Agent {
  const id = SessionId('local-skill-agent')
  const session = Session.create(id, [], { version: 1, id, createdAt: 0, cwd: '/workspace', ...(origin ? { origin } : {}) })
  return { ctx: new Context(), id, options: {}, session, inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }), status: 'idle', send() {}, followup() {}, steer() {}, inject() {}, cancel() {}, runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve() }
}

describe('local Skill publication', () => {
  it('publishes atomically below the local skills root and is idempotent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-local-skill-'))
    const input = { name: 'my-helper', description: 'A helper', instructions: 'Be concise.' }
    await expect(installLocalSkill(home, input)).resolves.toEqual({ name: 'my-helper', changed: true })
    await expect(installLocalSkill(home, input)).resolves.toEqual({ name: 'my-helper', changed: false })
    await expect(readFile(join(home, 'skills/my-helper/SKILL.md'), 'utf8')).resolves.toContain('Be concise.')
    await expect(installLocalSkill(home, { ...input, instructions: 'Different.' }))
      .rejects.toThrow('already exists with different content')
  })

  it('rejects invalid names and symlink destinations without writing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-local-skill-'))
    await expect(installLocalSkill(home, { name: '../escape', description: 'x', instructions: 'x' })).rejects.toThrow('invalid skill name')
    await mkdir(join(home, 'skills'), { recursive: true })
    await symlink(home, join(home, 'skills', 'linked'))
    await expect(installLocalSkill(home, { name: 'linked', description: 'x', instructions: 'x' })).rejects.toThrow('unsafe skill path')
  })

  it('asks for every install and denies subagents before any write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-local-skill-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalInstaller, { dshHome: home })
    let requests = 0
    ctx.on('approval/request', () => { requests += 1; return Promise.resolve<ApprovalOutcome>('allowed-once') })
    const normal = agent(); normal.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId('install'), name: 'skill_install', arguments: { name: 'approved', description: 'x', instructions: 'x' }, agent: normal })
    expect(result.isError).toBe(false)
    expect(requests).toBe(1)
    const child = agent('subagent'); child.session.append('turn/start', { turn: 1 })
    const denied = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId('child'), name: 'skill_install', arguments: { name: 'denied', description: 'x', instructions: 'x' }, agent: child })
    expect(denied.isError).toBe(true)
    expect(requests).toBe(1)
    await ctx.fiber.dispose()
  })

  it('does not publish a Skill when the user rejects the installation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-local-skill-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalInstaller, { dshHome: home })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    const normal = agent()
    normal.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('rejected-install'),
      name: 'skill_install',
      arguments: { name: 'not-installed', description: 'x', instructions: 'x' },
      agent: normal,
    })
    expect(result.isError).toBe(true)
    await expect(access(join(home, 'skills/not-installed/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.fiber.dispose()
  })
})
