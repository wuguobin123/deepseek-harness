import { create } from 'zustand';
import type {
  AccountAuthentication,
  SessionState,
  SessionUpdate
} from '../../shared/contracts';
import { workbenchApi } from '../api';

interface SessionStoreState {
  initialized: boolean;
  session: SessionState;
  error: string | null;
  refresh: () => Promise<void>;
  update: (input: SessionUpdate) => Promise<void>;
  authenticate: (input: AccountAuthentication) => Promise<boolean>;
  sendVerificationCode: (input: { baseUrl: string; email: string }) => Promise<
    | { ok: true; expiresInSeconds: number; retryAfterSeconds: number }
    | { ok: false; retryAfterSeconds: number }
  >;
  logout: () => Promise<void>;
}

const EMPTY_SESSION: SessionState = {
  tenantId: '',
  actorId: '',
  baseUrl: '',
  hasApiKey: false
};

export const useSessionStore = create<SessionStoreState>((set) => ({
  initialized: false,
  session: EMPTY_SESSION,
  error: null,
  async refresh() {
    try {
      const session = await workbenchApi.getSession();
      set({ initialized: true, session, error: null });
    } catch (err) {
      set({ initialized: true, session: EMPTY_SESSION, error: (err as Error).message });
    }
  },
  async update(input: SessionUpdate) {
    const result = await workbenchApi.updateSession(input);
    if (!result.ok) {
      const message = result.error?.message ?? 'failed to update session';
      set({ error: message });
      return;
    }
    if (result.session) {
      set({ session: result.session, error: null });
      return;
    }
    const session = await workbenchApi.getSession();
    set({ session });
  },
  async authenticate(input: AccountAuthentication) {
    const result = await workbenchApi.authenticateSession(input);
    if (!result.ok || !result.session) {
      set({ error: result.error?.message ?? '登录失败' });
      return false;
    }
    set({ session: result.session, error: null, initialized: true });
    return true;
  },
  async sendVerificationCode(input: { baseUrl: string; email: string }) {
    const result = await workbenchApi.sendEmailVerificationCode(input);
    if (!result.ok) {
      set({ error: result.error?.message ?? '验证码发送失败' });
      return { ok: false as const, retryAfterSeconds: result.error?.retry_after_seconds ?? 0 };
    }
    return {
      ok: true as const,
      expiresInSeconds: result.expires_in_seconds,
      retryAfterSeconds: result.retry_after_seconds
    };
  },
  async logout() {
    await workbenchApi.logoutSession();
    set({ session: EMPTY_SESSION, error: null, initialized: true });
  }
}));
