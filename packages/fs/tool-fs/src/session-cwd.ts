/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each session's
 * `read`/`write`/`edit` act on ITS workspace, not the server's launch dir — mirroring how
 * `dsh-tool-bash` defaults a bash `workdir` to the session cwd.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @deepseek-ai/dsh-tool-fs/session-cwd
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}

/**
 * Resolve one model path and optionally require its canonical identity to stay
 * under the calling session workspace. Deployments serving untrusted account
 * sessions enable this check so absolute paths and symlink escapes cannot turn
 * the host filesystem into an account-visible read surface.
 * @param ctx - plugin context providing the filesystem implementation.
 * @param exec - tool execution carrying the session workspace and signal.
 * @param requestedPath - model-controlled path to resolve.
 * @param workspaceOnly - whether the resolved target must stay below the session cwd.
 * @param policyWorkspaceRoot - mutation policy root, when already resolved.
 * @returns the resolved target after the optional containment check.
 */
export async function resolveSessionTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  workspaceOnly: boolean,
  policyWorkspaceRoot?: string,
): Promise<FsTarget> {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath, policyWorkspaceRoot))
  if (!workspaceOnly) return target
  if (cwd === undefined) {
    throw new FsError('file access requires an agent workspace', 'FS_SANDBOX_DENIED')
  }
  const root = await ctx.fs.resolve('.', { cwd, signal: exec.signal })
  if (!ctx.fs.contains(root, target)) {
    throw new FsError(`cannot access "${target.displayPath}": path is outside the session workspace`, 'FS_SANDBOX_DENIED')
  }
  return target
}
