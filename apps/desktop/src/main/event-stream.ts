/**
 * Main-process SSE proxy.
 *
 * The browser EventSource API cannot send custom auth headers. We open the
 * stream with `fetch` in the main process (which has access to the API key),
 * parse SSE frames, and forward them as IPC events to the renderer.
 *
 * Each subscription gets a unique ID. The proxy supports `Last-Event-ID`
 * reconnection and emits typed frames conforming to `AnomalyStreamEventSchema`.
 */
import { URL } from 'node:url';
import { AnomalyStreamEventSchema } from '../shared/contracts';
import { Credentials } from './credential-store';
import { mapAnomalyStreamEvent } from './wire-mappers';

export interface StreamOptions {
  baseUrl: string;
  credentials: () => Credentials;
  fetchImpl?: typeof fetch;
  onEvent: (event: AnomalyStreamEventLike) => void;
  signal?: AbortSignal;
  lastEventId?: number;
}

export interface AnomalyStreamEventLike {
  type: string;
  seq: number;
  payload: unknown;
}

const STREAM_PATH = '/api/anomalies/stream';
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;

export class AnomalyEventStream {
  private readonly baseUrl: string;
  private readonly getCredentials: () => Credentials;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, credentials: () => Credentials, fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getCredentials = credentials;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /**
   * Open an SSE stream. Returns an `AbortController` so the caller can stop the
   * stream. Reconnection (with `Last-Event-ID`) is the caller's responsibility;
   * we emit the most recent `seq` so they can replay.
   */
  open(onEvent: (e: AnomalyStreamEventLike) => void, signal?: AbortSignal): AbortController {
    const controller = new AbortController();
    const userSignal = signal;
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    void this.runLoop(onEvent, controller);
    return controller;
  }

  private async runLoop(
    onEvent: (e: AnomalyStreamEventLike) => void,
    controller: AbortController
  ): Promise<void> {
    let lastEventId: number | undefined;
    const startedAt = Date.now();

    while (!controller.signal.aborted) {
      if (Date.now() - startedAt > STREAM_TIMEOUT_MS) {
        // Per spec, single connection lifetime is bounded; abort and let the
        // caller reconnect.
        controller.abort();
        return;
      }

      try {
        const lastSeq = await this.connectOnce(onEvent, controller.signal, lastEventId);
        if (typeof lastSeq === 'number') lastEventId = lastSeq;
        if (controller.signal.aborted) return;
        // Reconnect immediately on graceful close.
      } catch {
        if (controller.signal.aborted) return;
        // Backoff on errors
        await new Promise((r) => setTimeout(r, 1_000));
        // Continue loop
      }
    }
  }

  private async connectOnce(
    onEvent: (e: AnomalyStreamEventLike) => void,
    signal: AbortSignal,
    lastEventId?: number
  ): Promise<number | undefined> {
    const url = new URL(STREAM_PATH, this.baseUrl).toString();
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache'
    };
    const creds = this.getCredentials();
    if (creds.apiKey) headers['X-API-Key'] = creds.apiKey;
    if (creds.tenantId) headers['X-Tenant-ID'] = creds.tenantId;
    if (creds.actorId) headers['X-Actor-ID'] = creds.actorId;
    if (typeof lastEventId === 'number') headers['Last-Event-ID'] = String(lastEventId);

    const res = await this.fetchImpl(url, { method: 'GET', headers, signal });
    if (!res.ok || !res.body) {
      throw new Error(`stream handshake failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentId: number | undefined;
    let lastData: string | null = null;
    let lastSeen = Date.now();

    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process line-by-line.
      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        this.processLine(line, (id, data) => {
          currentId = id;
          lastData = data;
          if (!data) return;
          try {
            const parsed = mapAnomalyStreamEvent(JSON.parse(data));
            const validated = AnomalyStreamEventSchema.safeParse(parsed);
            if (validated.success) {
              onEvent({
                type: validated.data.type,
                seq: validated.data.seq,
                payload: validated.data
              });
            }
          } catch {
            // ignore malformed frames
          }
        });
        lastSeen = Date.now();
        newlineIdx = buffer.indexOf('\n');
      }

      if (Date.now() - lastSeen > HEARTBEAT_TIMEOUT_MS) {
        // No frame in 30s — assume the stream died and reconnect.
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    void lastData;
    return currentId;
  }

  private processLine(
    line: string,
    emit: (id: number | undefined, data: string | null) => void
  ): void {
    if (!line) {
      // Empty line = dispatch boundary. We already emit per data line above.
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') {
      const num = Number.parseInt(value, 10);
      emit(Number.isFinite(num) ? num : undefined, null);
    } else if (field === 'data') {
      emit(undefined, value);
    }
  }
}
