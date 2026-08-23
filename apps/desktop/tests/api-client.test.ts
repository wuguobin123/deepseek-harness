import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/main/api-client';

describe('ApiClient connection switching', () => {
  it('uses the updated base URL for subsequent requests', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8001',
      credentials: () => ({
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001',
        baseUrl: 'http://127.0.0.1:8000'
      }),
      fetchImpl,
      maxRetries: 0
    });

    await client.request({ method: 'GET', path: '/api/context' });
    client.setBaseUrl('http://127.0.0.1:8000/');
    await client.request({ method: 'GET', path: '/api/context' });

    expect(urls).toEqual([
      'http://127.0.0.1:8001/api/context',
      'http://127.0.0.1:8000/api/context'
    ]);
  });

  it('allows a bounded longer timeout for model-backed page summaries', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      ) as unknown as typeof fetch;
      const client = new ApiClient({
        baseUrl: 'http://127.0.0.1:8000',
        credentials: () => ({
          apiKey: 'dev-api-key',
          tenantId: 'tenant-a',
          actorId: 'sup-001',
          baseUrl: 'http://127.0.0.1:8000'
        }),
        fetchImpl,
        maxRetries: 0,
        requestTimeoutMs: 30_000
      });

      const request = client.request({
        method: 'POST',
        path: '/api/conversations/CNV-1/external-result',
        body: {},
        timeoutMs: 120_000
      });
      const rejection = expect(request).rejects.toThrow('request failed');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(90_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends FormData without forcing a JSON content type', async () => {
    let requestInit: RequestInit | undefined;
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requestInit = init;
        return new Response(JSON.stringify({ artifact_id: 'ART-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    ) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000',
      credentials: () => ({
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001',
        baseUrl: 'http://127.0.0.1:8000'
      }),
      fetchImpl,
      maxRetries: 0
    });
    const form = new FormData();
    form.append('file', new Blob(['zip-bytes']), 'skills.zip');

    await client.request({
      method: 'POST',
      path: '/api/conversations/CNV-1/artifacts',
      body: form
    });

    expect(requestInit?.body).toBe(form);
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });
});

describe('ApiClient SSE streaming', () => {
  it('forwards split SSE frames and keeps authenticated request headers', async () => {
    const encoder = new TextEncoder();
    let requestInit: RequestInit | undefined;
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requestInit = init;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: accepted\ndata: {"type":"accepted","client_message_'
                )
              );
              controller.enqueue(
                encoder.encode(
                  'id":"desktop-1"}\n\nevent: delta\ndata: {"type":"delta","index":0,"delta":"你好"}\n\n'
                )
              );
              controller.close();
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
          }
        );
      }
    ) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000',
      credentials: () => ({
        apiKey: 'dev-api-key',
        tenantId: 'tenant-a',
        actorId: 'sup-001',
        baseUrl: 'http://127.0.0.1:8000'
      }),
      fetchImpl
    });
    const events: unknown[] = [];

    await client.streamSse(
      {
        method: 'POST',
        path: '/api/conversations/CNV-1/assistant/stream',
        body: { message: '你好' },
        idempotencyKey: 'desktop-1'
      },
      (event) => events.push(event)
    );

    expect(events).toEqual([
      {
        event: 'accepted',
        data: { type: 'accepted', clientMessageId: 'desktop-1' }
      },
      {
        event: 'delta',
        data: { type: 'delta', index: 0, delta: '你好' }
      }
    ]);
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers.Accept).toBe('text/event-stream');
    expect(headers['X-API-Key']).toBe('dev-api-key');
    expect(headers['Idempotency-Key']).toBe('desktop-1');
  });
});
