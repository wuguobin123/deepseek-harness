/**
 * Main-process HTTP client.
 *
 * Adds X-API-Key, X-Tenant-ID, X-Actor-ID, Idempotency-Key and X-Expected-Version
 * to every request. Retries idempotent methods (GET/PUT) with exponential backoff
 * for transient 5xx / network errors. Streams responses for SSE consumers.
 */
import { URL } from 'node:url';
import { Credentials } from './credential-store';
import { mapWorkbenchResponse } from './wire-mappers';

export interface ApiClientOptions {
  baseUrl: string;
  credentials: () => Credentials;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
}

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedVersion?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface ApiSseEvent<T = unknown> {
  event: string;
  data: T;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'HEAD', 'OPTIONS']);

export class ApiClient {
  private baseUrl: string;
  private readonly getCredentials: () => Credentials;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = ApiClient.normalizeBaseUrl(options.baseUrl);
    this.getCredentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = ApiClient.normalizeBaseUrl(baseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private static normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/, '');
  }

  private buildHeaders(idempotencyKey?: string, expectedVersion?: number): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    const creds = this.getCredentials();
    if (creds.apiKey) headers['X-API-Key'] = creds.apiKey;
    if (creds.tenantId) headers['X-Tenant-ID'] = creds.tenantId;
    if (creds.actorId) headers['X-Actor-ID'] = creds.actorId;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (typeof expectedVersion === 'number') {
      headers['If-Match'] = String(expectedVersion);
      headers['X-Expected-Version'] = String(expectedVersion);
    }
    return headers;
  }

  async request<T = unknown>(options: ApiRequestOptions): Promise<ApiResponse<T>> {
    const url = new URL(options.path, this.baseUrl).toString();
    const headers = this.buildHeaders(options.idempotencyKey, options.expectedVersion);
    let body: string | FormData | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (options.body instanceof FormData) {
        // fetch adds the multipart boundary. Setting Content-Type manually
        // would make the boundary invalid.
        body = options.body;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? this.requestTimeoutMs
      );
      const signal = options.signal
        ? composeSignals(controller.signal, options.signal)
        : controller.signal;
      try {
        const res = await this.fetchImpl(url, {
          method: options.method,
          headers,
          body,
          signal
        });
        clearTimeout(timeout);

        const text = await res.text();
        let parsed: unknown = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }

        if (res.status >= 500 && IDEMPOTENT_METHODS.has(options.method) && attempt < this.maxRetries) {
          await sleep(backoff(this.retryBaseMs, attempt));
          continue;
        }

        return {
          status: res.status,
          body: mapWorkbenchResponse(
            options.path,
            options.method,
            parsed,
            res.status
          ) as T
        };
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
        if (!IDEMPOTENT_METHODS.has(options.method) || attempt >= this.maxRetries) break;
        await sleep(backoff(this.retryBaseMs, attempt));
      }
    }
    throw new ApiClientError('NETWORK_ERROR', 'request failed', 0, lastError);
  }

  async streamSse<T = unknown>(
    options: ApiRequestOptions,
    listener: (event: ApiSseEvent<T>) => void
  ): Promise<void> {
    const url = new URL(options.path, this.baseUrl).toString();
    const headers = this.buildHeaders(
      options.idempotencyKey,
      options.expectedVersion
    );
    headers.Accept = 'text/event-stream';
    let body: string | undefined;
    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    const idleTimeoutMs = options.timeoutMs ?? Math.max(this.requestTimeoutMs, 90_000);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimeout = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), idleTimeoutMs);
    };
    resetIdleTimeout();
    const signal = options.signal
      ? composeSignals(controller.signal, options.signal)
      : controller.signal;
    try {
      const response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body,
        signal
      });
      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => '');
        throw new ApiClientError(
          `HTTP_${response.status}`,
          message || `stream handshake failed: ${response.status}`,
          response.status
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamEnded = false;
      while (!streamEnded) {
        const next = await reader.read();
        if (next.done) {
          streamEnded = true;
          continue;
        }
        const { value } = next;
        resetIdleTimeout();
        buffer += decoder.decode(value, { stream: true });
        let boundary = findSseBoundary(buffer);
        while (boundary) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const parsed = parseSseFrame(frame);
          if (parsed) {
            listener({
              event: parsed.event,
              data: mapWorkbenchResponse(
                options.path,
                options.method,
                parsed.data,
                response.status
              ) as T
            });
          }
          boundary = findSseBoundary(buffer);
        }
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  override readonly cause?: unknown;
  constructor(code: string, message: string, status: number, cause?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

function backoff(base: number, attempt: number): number {
  return Math.min(base * 2 ** attempt, 5_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}

function findSseBoundary(
  value: string
): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function parseSseFrame(
  frame: string
): { event: string; data: unknown } | null {
  let event = 'message';
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice(6).trim();
    } else if (rawLine.startsWith('data:')) {
      data.push(rawLine.slice(5).trimStart());
    }
  }
  if (data.length === 0) return null;
  const value = data.join('\n');
  try {
    return { event, data: JSON.parse(value) };
  } catch {
    return { event, data: value };
  }
}
