/** Keyless assembled snapshot for the local Xiaowei workspace profile. */

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DEVICE_RUNTIME = join(REPO_ROOT, 'apps/xiaowei-device-runtime')
const LOCAL_BUNDLE = join(REPO_ROOT, 'packages/bundle/xiaowei-local')

function toolNames(ctx: Context, agent?: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name).sort()
}

async function bootLocalProfile(): Promise<Context> {
  process.env.XIAOWEI_LOCAL_PRESET_ROOT = join(LOCAL_BUNDLE, 'agent-presets')
  const basePatch = join(DEVICE_RUNTIME, 'cordis.base.patch.yml')
  const devicePatch = join(DEVICE_RUNTIME, 'cordis.patch.yml')
  const overrides = [
    ...loadOverlayPatches('xiaowei-local-snapshot', basePatch),
    ...loadOverlayPatches('xiaowei-local-snapshot', devicePatch),
    { id: 'device-host', disabled: true },
  ]
  return await boot(
    'xiaowei-local-snapshot',
    join(DEVICE_RUNTIME, 'cordis.yml'),
    overrides,
    undefined,
    pathToFileURL(join(DEVICE_RUNTIME, 'package.json')).href,
  )
}

describe('Xiaowei local workspace assembled profile', () => {
  it('keeps the live directory local and installs Skills in the local Harness home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaowei-local-snapshot-'))
    const home = join(root, '.dsh')
    const workspacePath = join(root, 'workspace')
    const outsidePath = join(root, 'outside')
    const previousHome = process.env.DSH_HOME
    const previousPresetRoot = process.env.XIAOWEI_LOCAL_PRESET_ROOT
    process.env.DSH_HOME = home
    await mkdir(workspacePath, { recursive: true })
    await mkdir(outsidePath, { recursive: true })
    await writeFile(join(workspacePath, 'inside.txt'), 'inside\n')
    await writeFile(join(outsidePath, 'secret.txt'), 'secret\n')
    await symlink(outsidePath, join(workspacePath, 'escape'))
    let ctx: Context | undefined
    try {
      ctx = await bootLocalProfile()
      const workspace = await ctx.workspaceRegistry.create(workspacePath)
      const handle = await ctx.agents.create({
        sessionId: SessionId('xiaowei-local-snapshot'),
        meta: { cwd: workspace.path, agentPreset: 'xiaowei-local-safe' },
        setup: agentCtx => ctx!.agentPresets.mount(agentCtx, 'xiaowei-local-safe').then(() => undefined),
      })
      try {
        ctx.on(
          'approval/request',
          () => Promise.resolve<ApprovalOutcome>('allowed-once'),
          { prepend: true },
        )
        handle.agent.session.append('turn/start', { turn: 1 })
        const inside = await ctx.tools.execute({
          callId: CallId('local-read-inside'),
          name: 'read',
          arguments: { file_path: 'inside.txt' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        await writeFile(join(workspacePath, 'inside.txt'), 'external\n')
        const external = await ctx.tools.execute({
          callId: CallId('local-read-external-edit'),
          name: 'read',
          arguments: { file_path: 'inside.txt' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const traversal = await ctx.tools.execute({
          callId: CallId('local-read-traversal'),
          name: 'read',
          arguments: { file_path: '../outside/secret.txt' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const symlinkEscape = await ctx.tools.execute({
          callId: CallId('local-read-symlink'),
          name: 'read',
          arguments: { file_path: 'escape/secret.txt' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const edit = await ctx.tools.execute({
          callId: CallId('local-edit'),
          name: 'edit',
          arguments: { file_path: 'inside.txt', old_string: 'external', new_string: 'changed' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const shell = await ctx.tools.execute({
          callId: CallId('local-shell'),
          name: process.platform === 'win32' ? 'pwsh' : 'bash',
          arguments: process.platform === 'win32'
            ? { command: "Set-Content -Path shell.txt -Value 'shell-local'", description: 'write workspace proof' }
            : { command: "printf 'shell-local\\n' > shell.txt", description: 'write workspace proof' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const workflow = await ctx.tools.execute({
          callId: CallId('local-workflow'),
          name: 'workflow',
          arguments: {
            script: 'return { local: true }',
            meta: { name: 'local-proof', description: 'Keyless local workflow proof' },
            args: {},
          },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const glob = await ctx.tools.execute({
          callId: CallId('local-glob'),
          name: 'glob',
          arguments: { pattern: '*.txt' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const grep = await ctx.tools.execute({
          callId: CallId('local-grep'),
          name: 'grep',
          arguments: { pattern: 'changed' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const installed = await ctx.tools.execute({
          callId: CallId('local-skill-install'),
          name: 'skill_install',
          arguments: {
            name: 'local-proof',
            description: 'Snapshot proof Skill',
            instructions: 'Read only the selected workspace.',
          },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        if (installed.isError) {
          throw new Error(`local Skill installation failed: ${JSON.stringify(installed.content)}`)
        }
        const skillGesture = createUserMessage({
          content: [{ type: 'text', text: '/local-proof verify' }],
          source: { kind: 'user' },
        })
        const skillDecision = await agentEvents(ctx, handle.agent).waterfall(
          'agent/pre-step',
          {
            messages: [skillGesture],
            turn: 1,
            step: 1,
            signal: new AbortController().signal,
          },
          () => Promise.resolve({ kind: 'enter' as const, messages: [skillGesture] }),
        )
        const skillInvocationCount = skillDecision.kind === 'enter'
          ? skillDecision.messages.filter((message) => {
            const source = message.source as { kind?: string; name?: string }
            return source.kind === 'skill-invocation' && source.name === 'local-proof'
          }).length
          : -1
        handle.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        const skill = await readFile(join(home, 'skills/local-proof/SKILL.md'), 'utf8')
        const discoveredSkills = (await ctx.skills.list({ scope: handle.agent })).map(item => item.name)
        expect({
          hostTools: toolNames(ctx),
          presets: (await ctx.agentPresets.list()).map(preset => preset.id),
          defaultPreset: ctx.agentPresets.defaultId,
          workspacePath: workspace.path === await realpath(workspacePath) ? '{{selected-directory}}' : workspace.path,
          agentTools: toolNames(ctx, handle.agent),
          insideReadFailed: inside.isError,
          externalEditObserved: !external.isError && JSON.stringify(external.content).includes('external'),
          traversalReadFailed: traversal.isError,
          traversalDiagnostic: JSON.stringify(traversal.content).includes('outside the session workspace'),
          symlinkReadFailed: symlinkEscape.isError,
          editFailed: edit.isError,
          editedSource: await readFile(join(workspacePath, 'inside.txt'), 'utf8'),
          shellFailed: shell.isError,
          shellSource: await readFile(join(workspacePath, 'shell.txt'), 'utf8'),
          workflowFailed: workflow.isError,
          subagentProviders: ctx.subagents.list().sort(),
          globFailed: glob.isError,
          grepFailed: grep.isError,
          skillInstallFailed: installed.isError,
          skillDiscoveredWithoutRestart: discoveredSkills.includes('local-proof'),
          skillInvocationCount,
          skill,
        }).toMatchInlineSnapshot(`
          {
            "agentTools": [
              "ask_user_question",
              "bash",
              "create_goal",
              "edit",
              "exit_plan_mode",
              "get_goal",
              "glob",
              "grep",
              "interrupt_agent",
              "job_kill",
              "job_list",
              "job_output",
              "list_agents",
              "ralph",
              "read",
              "read_image",
              "send_message",
              "skill",
              "skill_install",
              "str_replace_editor",
              "subagent",
              "subagent_fork",
              "todo_write",
              "update_goal",
              "web_search",
              "workflow",
              "write",
            ],
            "defaultPreset": "xiaowei-local-safe",
            "editFailed": false,
            "editedSource": "changed
          ",
            "externalEditObserved": true,
            "globFailed": false,
            "grepFailed": false,
            "hostTools": [
              "bash",
              "create_goal",
              "edit",
              "exit_plan_mode",
              "get_goal",
              "glob",
              "grep",
              "interrupt_agent",
              "job_kill",
              "job_list",
              "job_output",
              "list_agents",
              "ralph",
              "read",
              "read_image",
              "send_message",
              "skill",
              "str_replace_editor",
              "subagent",
              "subagent_fork",
              "todo_write",
              "update_goal",
              "web_search",
              "workflow",
              "write",
            ],
            "insideReadFailed": false,
            "presets": [
              "xiaowei-local-safe",
            ],
            "shellFailed": false,
            "shellSource": "shell-local
          ",
            "skill": "---
          name: local-proof
          description: "Snapshot proof Skill"
          ---

          Read only the selected workspace.
          ",
            "skillDiscoveredWithoutRestart": true,
            "skillInstallFailed": false,
            "skillInvocationCount": 1,
            "subagentProviders": [
              "fork",
              "spawn",
            ],
            "symlinkReadFailed": true,
            "traversalDiagnostic": true,
            "traversalReadFailed": true,
            "workflowFailed": false,
            "workspacePath": "{{selected-directory}}",
          }
        `)
      } finally {
        await handle.dispose()
      }
    } finally {
      await ctx?.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousPresetRoot === undefined) delete process.env.XIAOWEI_LOCAL_PRESET_ROOT
      else process.env.XIAOWEI_LOCAL_PRESET_ROOT = previousPresetRoot
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
