/**
 * Session store (renderer-side).
 *
 * Persists the dsh-ops baseUrl through `workbenchApi.updateSession` and
 * exposes the current value to the rest of the renderer. Authentication is
 * out of scope — the desktop client trusts the loopback / `trustedHosts`
 * fence on `dsh-client-connection`.
 */
import { create } from 'zustand';
import type { SessionState } from '../../shared/contracts';
import * as api from '../api';

interface SessionStoreState {
  initialized: boolean;
  session: SessionState;
  error: string | null;
  refresh: () => Promise<void>;
  updateBaseUrl: (baseUrl: string) => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_SESSION: SessionState = { baseUrl: '', version: '2' };

export const useSessionStore = create<SessionStoreState>((set) => ({
  initialized: false,
  session: EMPTY_SESSION,
  error: null,
  async refresh() {
    try {
      const session = await api.getSession();
      set({ initialized: true, session, error: null });
    } catch (err) {
      set({ initialized: true, session: EMPTY_SESSION, error: (err as Error).message });
    }
  },
  async updateBaseUrl(baseUrl: string) {
    const result = await api.updateSession({ baseUrl });
    if (!result.ok) {
      set({ error: result.error.message });
      return { ok: false, error: result.error.message };
    }
    if (window.workbenchApi.setBaseUrl) {
      window.workbenchApi.setBaseUrl(baseUrl);
    }
    set({ session: { baseUrl, version: '2' }, error: null });
    return { ok: true };
  }
}));