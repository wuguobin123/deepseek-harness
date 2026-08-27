import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionOwnerId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import LocalAccountSkillStore from '@deepseek-ai/dsh-account-skill-store'
import * as ToolSkillInstall from '@deepseek-ai/dsh-tool-skill-install'
import { describe, expect, it } from 'vitest'

function accountAgent(ownerId?: string, origin?: 'subagent'): Agent {
  const id = SessionId(`skill-install-${ownerId ?? 'anonymous'}`)
  const session = Session.create(id, [], {
    version: 1, id, createdAt: 0, cwd: '/workspace',
    ...ownerId === undefined ? {} : { ownerId: SessionOwnerId(ownerId) },
    ...origin === undefined ? {} : { origin },
  })
  return {
    ctx: new Context(), id, options: {}, session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
}

describe('skill_install tool', () => {
  it('derives ownership from the agent, hides server paths, and refreshes the catalog', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tool-skill-install-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalAccountSkillStore, { dshHome })
    await ctx.plugin(ToolSkillInstall)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    let changes = 0
    ctx.on('skills/change', () => { changes += 1 })
    const agent = accountAgent('user-a')
    agent.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('install'), name: 'skill_install',
      arguments: { name: 'private-helper', description: 'Private helper', instructions: 'Answer briefly.' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(result.content).toMatchInlineSnapshot(`
      [
        {
          "text": "Installed skill private-helper",
          "type": "text",
        },
      ]
    `)
    expect(JSON.stringify(result.content)).not.toContain(dshHome)
    expect(JSON.stringify(result.content)).not.toContain('user-a')
    expect(changes).toBe(1)
    expect(agent.session.events.map(event => event.type).slice(-3)).toEqual([
      'turn/start', 'approval/asked', 'approval/decided',
    ])
    const hash = createHash('sha256').update('user-a').digest('hex')
    expect(await readFile(join(await realpath(dshHome), 'accounts', hash, 'skills/private-helper/SKILL.md'), 'utf8')).toContain('Answer briefly.')
    const anonymousAgent = accountAgent()
    anonymousAgent.session.append('turn/start', { turn: 1 })
    const anonymous = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('anonymous'), name: 'skill_install',
      arguments: { name: 'anonymous-helper', description: 'No owner', instructions: 'No.' },
      agent: anonymousAgent,
    })
    expect(anonymous.isError).toBe(true)
    expect(JSON.stringify(anonymous.content)).toContain('account owner is required')
    await ctx.fiber.dispose()
  })

  it('does not write or refresh when the account rejects the proposal', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tool-skill-reject-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalAccountSkillStore, { dshHome })
    await ctx.plugin(ToolSkillInstall)
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    let changes = 0
    ctx.on('skills/change', () => { changes += 1 })
    const agent = accountAgent('user-b')
    agent.session.append('turn/start', { turn: 1 })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('reject'), name: 'skill_install',
      arguments: { name: 'rejected-helper', description: 'Rejected helper', instructions: 'Do not install.' },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('the user rejected tool')
    expect(changes).toBe(0)
    expect(agent.session.events.map(event => event.type).slice(-3)).toEqual([
      'turn/start', 'approval/asked', 'approval/decided',
    ])
    const hash = createHash('sha256').update('user-b').digest('hex')
    await expect(readFile(join(await realpath(dshHome), 'accounts', hash, 'skills/rejected-helper/SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.fiber.dispose()
  })

  it('rejects subagents before approval and does not write or refresh', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tool-skill-subagent-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalAccountSkillStore, { dshHome })
    await ctx.plugin(ToolSkillInstall)
    let approvalRequests = 0
    ctx.on('approval/request', () => {
      approvalRequests += 1
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    let changes = 0
    ctx.on('skills/change', () => { changes += 1 })
    const agent = accountAgent('user-subagent', 'subagent')
    agent.session.append('turn/start', { turn: 1 })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('subagent'), name: 'skill_install',
      arguments: { name: 'subagent-helper', description: 'Subagent helper', instructions: 'Do not install.' },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('a subagent cannot install account skills')
    expect(approvalRequests).toBe(0)
    expect(changes).toBe(0)
    expect(agent.session.events.map(event => event.type)).toEqual(['session/end-seed', 'turn/start'])
    const hash = createHash('sha256').update('user-subagent').digest('hex')
    await expect(readFile(join(await realpath(dshHome), 'accounts', hash, 'skills/subagent-helper/SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.fiber.dispose()
  })

  it('fails closed under the never approval policy without writing or refreshing', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-tool-skill-never-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(LocalAccountSkillStore, { dshHome })
    await ctx.plugin(ToolSkillInstall)
    let changes = 0
    ctx.on('skills/change', () => { changes += 1 })
    const agent = accountAgent('user-never')
    agent.session.append('turn/start', { turn: 1 })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal, callId: CallId('never'), name: 'skill_install',
      arguments: { name: 'never-helper', description: 'Never helper', instructions: 'Do not install.' },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('the user rejected tool')
    expect(changes).toBe(0)
    expect(agent.session.events.map(event => event.type).slice(-3)).toEqual([
      'turn/start', 'approval/asked', 'approval/decided',
    ])
    expect(agent.session.events.at(-1)).toMatchObject({ data: { outcome: 'rejected' } })
    const hash = createHash('sha256').update('user-never').digest('hex')
    await expect(readFile(join(await realpath(dshHome), 'accounts', hash, 'skills/never-helper/SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.fiber.dispose()
  })
})
