import { create } from 'zustand';
import type { AppUpdateState } from '../../shared/contracts';
import { workbenchApi } from '../api';

interface AppUpdateStoreState {
  /** null = 尚未拿到主进程状态（未订阅/未初始化）。 */
  state: AppUpdateState | null;
  checking: boolean;
  initialize: () => Promise<void>;
  check: () => Promise<void>;
  openDownload: () => Promise<{ ok: boolean; error?: string }>;
}

let unsubscribe: (() => void) | null = null;

export const useAppUpdateStore = create<AppUpdateStoreState>((set) => ({
  state: null,
  checking: false,
  async initialize() {
    if (unsubscribe) return;
    unsubscribe = await workbenchApi.subscribeAppUpdateState((state) => {
      set({ state, checking: state.status === 'checking' });
    });
  },
  async check() {
    set({ checking: true });
    try {
      const state = await workbenchApi.checkAppUpdate();
      set({ state, checking: false });
    } catch {
      set({ checking: false });
    }
  },
  async openDownload() {
    return workbenchApi.openAppUpdateDownload();
  }
}));
