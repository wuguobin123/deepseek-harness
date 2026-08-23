import { create } from 'zustand';
import type { Anomaly, AnomalyStreamEvent } from '../../shared/contracts';
import { workbenchApi } from '../api';

interface Filters {
  status: string;
  severity: string;
  owner: string;
}

interface AnomaliesStoreState {
  items: Anomaly[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
  filters: Filters;
  setFilter: (key: keyof Filters, value: string) => void;
  load: () => Promise<void>;
  applyEvent: (event: AnomalyStreamEvent) => void;
}

const defaultFilters: Filters = { status: '', severity: '', owner: '' };

export const useAnomaliesStore = create<AnomaliesStoreState>((set, get) => ({
  items: [],
  cursor: null,
  loading: false,
  error: null,
  filters: defaultFilters,
  setFilter(key, value) {
    set({ filters: { ...get().filters, [key]: value } });
  },
  async load() {
    set({ loading: true, error: null });
    try {
      const filters = get().filters;
      const page = await workbenchApi.listAnomalies({
        status: filters.status || undefined,
        severity: filters.severity || undefined,
        owner: filters.owner || undefined
      });
      set({ items: page.items, cursor: page.nextCursor, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
  applyEvent(event) {
    if (event.type === 'heartbeat') return;
    if (event.type === 'anomaly.resolved') {
      set({
        items: get().items.filter((a) => a.anomalyId !== event.anomalyId)
      });
      return;
    }
    if ('anomaly' in event) {
      const incoming = event.anomaly;
      const existing = get().items.findIndex((a) => a.anomalyId === incoming.anomalyId);
      if (existing >= 0) {
        const next = get().items.slice();
        next[existing] = incoming;
        set({ items: next });
      } else {
        set({ items: [incoming, ...get().items] });
      }
    }
  }
}));