/**
 * Renderer-side API wrapper.
 *
 * Thin typed wrappers over `window.workbenchApi.request(method, payload)` —
 * each helper builds the right envelope and forwards to the IPC bridge. The
 * bridge in turn POSTs `${baseUrl}/api/<method>` with a ClientRequest envelope.
 *
 * Subscription helpers (`subscribeMux`, `subscribeHost`, `respond`) re-export
 * the matching bridge keys so feature pages don't reach past `api.ts`.
 */
import type {
  HostFrame,
  MuxFrame,
  SessionState
} from '../shared/contracts';
import type { WorkbenchApi } from '../preload/index';

declare global {
  interface Window {
    workbenchApi: WorkbenchApi & { setBaseUrl?: (url: string) => void };
    __WORKBENCH_API_OVERRIDE__?: WorkbenchApi;
  }
}

function bridge(): WorkbenchApi {
  return window.__WORKBENCH_API_OVERRIDE__ ?? window.workbenchApi;
}

type RpcOk<T> = { ok: true; value: T };
type RpcErr = { ok: false; error: { code: string; message: string } };
type RpcResult<T> = RpcOk<T> | RpcErr;

async function call<T = unknown>(method: string, payload: unknown): Promise<T> {
  const result = (await bridge().request(method, payload)) as RpcResult<T>;
  if (result.ok) return result.value;
  throw Object.assign(new Error(result.error.message), { code: result.error.code });
}

// ----- Host -----

export interface HostDescribe {
  name: string;
  version: string;
  platform: string;
  capabilities?: string[];
  models?: Array<{
    provider: string;
    model: string;
    label?: string;
    selected?: boolean;
  }>;
}

export const host = {
  describe: () => call<HostDescribe>('host.describe', {})
};

// ----- Sessions -----

export interface SessionListItem {
  sessionId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  blank?: boolean;
  cwd?: string;
  parentSessionId?: string;
  agentPreset?: string;
}

export const session = {
  list: (input: { workspaceId?: string } = {}) => call<SessionListItem[]>('session.list', input),
  create: (input: { workspaceId?: string; agentPreset?: string; title?: string } = {}) =>
    call<{ sessionId: string }>('session.create', input),
  history: (input: { sessionId: string; since?: number; limit?: number }) =>
    call<{ events: Array<{ type: string; sessionId: string; payload: unknown }> }>('session.history', input),
  prompt: (input: { sessionId: string; content: string; attachments?: unknown[] }) =>
    call<{ accepted: boolean }>('session.prompt', input),
  cancel: (input: { sessionId: string }) => call<{ ok: boolean }>('session.cancel', input),
  rename: (input: { sessionId: string; title: string }) => call<{ ok: boolean }>('session.rename', input),
  fork: (input: { sessionId: string }) => call<{ sessionId: string }>('session.fork', input),
  search: (input: { query: string; limit?: number }) =>
    call<Array<{ sessionId: string; title?: string; updatedAt?: string; snippet?: string }>>('session.search', input),
  models: (input: { sessionId: string }) => call<{ models: Array<{ provider: string; model: string }> }>('session.models', input),
  selectModel: (input: { sessionId: string; provider: string; model: string }) =>
    call<{ ok: boolean }>('session.selectModel', input)
};

// ----- Workspace -----

export const workspace = {
  list: () => call<Array<{ workspaceId: string; name: string }>>('workspace.list', {})
};

// ----- Skills -----

export const skill = {
  list: () => call<Array<{ id: string; name: string; description?: string }>>('skill.list', {})
};

// ----- Agent presets -----

export const agentPreset = {
  list: () => call<Array<{ id: string; name: string; description?: string }>>('agentPreset.list', {})
};

// ----- LLM -----

export const llm = {
  providers: () => call<Array<{ provider: string; models: Array<{ id: string; label?: string }> }>>('llm.providers', {})
};

// ----- Subscriptions (SSE fan-out) -----

export function subscribeMux(
  listener: (envelope: { rpcId: string; method: string; payload: MuxFrame }) => void
): Promise<() => Promise<void>> {
  return bridge().subscribeMux(listener);
}

export function subscribeHost(
  listener: (envelope: { rpcId: string; method: string; payload: HostFrame }) => void
): Promise<() => Promise<void>> {
  return bridge().subscribeHost(listener);
}

export async function respond(rpcId: string, value: unknown, error?: { code: string; message: string; details?: Record<string, unknown> }): Promise<void> {
  if (error) {
    return bridge().respond(rpcId, undefined, error);
  }
  return bridge().respond(rpcId, value);
}

// ----- Settings persistence -----

export async function getSession(): Promise<SessionState> {
  return bridge().getSession();
}

export async function updateSession(input: { baseUrl: string }): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
  return bridge().updateSession(input);
}

// ----- Update check (stub) -----

export const update = {
  getState: () => bridge().getAppUpdateState(),
  check: () => bridge().checkAppUpdate(),
  subscribe: (listener: (state: { status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'; currentVersion: string }) => void) =>
    bridge().subscribeAppUpdateState(listener)
};