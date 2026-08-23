import { create } from 'zustand';
import type { Trigger, TriggerUpsert } from '../../shared/contracts';
import { workbenchApi } from '../api';

interface TriggersStoreState {
  items: Trigger[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: TriggerUpsert) => Promise<Trigger | null>;
  update: (id: string, expectedVersion: number, patch: Partial<TriggerUpsert>) => Promise<Trigger | null>;
  enable: (id: string, expectedVersion: number) => Promise<void>;
  disable: (id: string, expectedVersion: number) => Promise<void>;
}

export const useTriggersStore = create<TriggersStoreState>((set, get) => ({
  items: [],
  cursor: null,
  loading: false,
  error: null,
  async load() {
    set({ loading: true, error: null });
    try {
      const page = await workbenchApi.listTriggers();
      set({ items: page.items, cursor: page.nextCursor, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
  async create(input) {
    try {
      const created = await workbenchApi.createTrigger(input);
      set({ items: [created, ...get().items] });
      return created;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },
  async update(id, expectedVersion, patch) {
    try {
      const updated = await workbenchApi.updateTrigger(id, expectedVersion, patch);
      set({
        items: get().items.map((t) => (t.triggerId === id ? updated : t))
      });
      return updated;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },
  async enable(id, expectedVersion) {
    try {
      const updated = await workbenchApi.enableTrigger(id, expectedVersion);
      set({ items: get().items.map((t) => (t.triggerId === id ? updated : t)) });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
  async disable(id, expectedVersion) {
    try {
      const updated = await workbenchApi.disableTrigger(id, expectedVersion);
      set({ items: get().items.map((t) => (t.triggerId === id ? updated : t)) });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  }
}));