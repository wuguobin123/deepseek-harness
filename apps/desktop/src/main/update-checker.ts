/**
 * Stub update checker (PR 3 — post-my-agents-only-feature-removal).
 *
 * The previous implementation polled `/releases/latest.json` against the
 * my-agents backend. The dsh-ops backend does not yet expose a releases
 * endpoint, so this stub always reports "no updates available". The Settings
 * page keeps its "check for updates" affordance; the IPC plumbing in
 * `index.ts` and `ipc-handlers.ts` continues to typecheck.
 *
 * When dsh-ops exposes a releases endpoint, replace this with a real
 * implementation that uses the same `AppUpdateState` envelope.
 */
import type { AppUpdateState } from '../shared/contracts'

export interface UpdateCheckerDeps {
  /** Kept for API stability with the old implementation; the stub does not fetch. */
  baseUrl?: () => string
  currentVersion: string
  onStateChange: (state: AppUpdateState) => void
  /** Test seams — unused by the stub but preserved for the planned restoration. */
  fetchImpl?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  runInstaller?: (platform: NodeJS.Platform) => Promise<void>
  platform?: NodeJS.Platform
  arch?: string
  pollIntervalMs?: number
}

export function compareVersions(_a: string, _b: string): number {
  return 0
}

export function platformFileKey(_platform: NodeJS.Platform, _arch: string): string | null {
  return null
}

export class UpdateChecker {
  private state: AppUpdateState

  constructor(private readonly deps: UpdateCheckerDeps) {
    this.state = { status: 'up-to-date', currentVersion: deps.currentVersion }
  }

  getState(): AppUpdateState {
    return this.state
  }

  start(): void {
    this.deps.onStateChange(this.state)
  }

  stop(): void {
    // No timer in the stub.
  }

  async check(): Promise<AppUpdateState> {
    return this.state
  }

  async openDownload(): Promise<void> {
    throw new Error('当前没有可用的更新')
  }
}
