import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { lookup } from 'node:dns/promises'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'
import * as AccountPlatform from '../src/index.ts'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

const route = 'xiaowei-minimax'
const model = 'MiniMax-M3'
const ownerId = 'user-alice'
const productionLengthSessionId = `session-${'a'.repeat(36)}`

interface ReserveInput { reservationId: string; amountMicros: number }
interface ReserveOutput { reservationId: string; reservedMicros: number }
interface SettleInput { reservationId: string; idempotencyKey: string; actualMicros: number }
interface CustomLookupInput { userId: string; customModelId: string }
interface ActiveCredential {
  token: string
  route: string
  model: string
  inputPriceMicrosPerToken: number
  outputPriceMicrosPerToken: number
}
type ReserveMock = ReturnType<typeof vi.fn<(input: ReserveInput) => Promise<ReserveOutput>>>
type SettleMock = ReturnType<typeof vi.fn<(input: SettleInput) => Promise<object>>>
type CancelMock = ReturnType<typeof vi.fn<(input: { reservationId: string }) => Promise<object>>>
type ProvisionMock = ReturnType<typeof vi.fn<(input: { userId: string }) => Promise<object>>>
type ResolveActiveMock = ReturnType<typeof vi.fn<(input: { userId: string }) => Promise<ActiveCredential | undefined>>>
type ResolveCustomMock = ReturnType<typeof vi.fn<(input: CustomLookupInput) => Promise<unknown>>>

function options(provider = route): GenerateOptions {
  return {
    provider,
    model,
    sessionId: 'session-alice' as never,
    messages: [],
    maxTokens: 32,
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function harness(overrides: {
  resolveActive?: ResolveActiveMock
  resolveCustom?: ResolveCustomMock
  reserve?: ReserveMock
  missingUsagePolicy?: 'reserve' | 'cancel'
} = {}): Promise<{
  ctx: Context
  reserve: ReserveMock
  settle: SettleMock
  cancel: CancelMock
  provision: ProvisionMock
}> {
  const ctx = new Context()
  const reserve = overrides.reserve ?? vi.fn(async (input: ReserveInput) => ({
    reservationId: input.reservationId,
    reservedMicros: input.amountMicros,
  }))
  const settle = vi.fn<(input: SettleInput) => Promise<object>>(async () => ({}))
  const cancel = vi.fn<(input: { reservationId: string }) => Promise<object>>(async () => ({}))
  const provision = vi.fn<(input: { userId: string }) => Promise<object>>(async () => ({}))
  const resolveActive = overrides.resolveActive ?? vi.fn<(input: { userId: string }) => Promise<ActiveCredential>>(async () => ({
    token: 'sk_account_secret',
    route,
    model,
    inputPriceMicrosPerToken: 1,
    outputPriceMicrosPerToken: 8,
  }))
  await ctx.plugin(LlmRuntime)
  ctx.provide('sessions', { get: (sessionId: string) => sessionId === 'session-alice' || sessionId === productionLengthSessionId ? { header: { ownerId } } : undefined } as never)
  ctx.provide('wallet', { reserve, settle, cancel } as never)
  ctx.provide('userModelKeys', {
    resolveActive,
    provision,
    resolveCustom: overrides.resolveCustom ?? vi.fn<(input: CustomLookupInput) => Promise<undefined>>(async () => undefined),
  } as never)
  await ctx.plugin(AccountPlatform, {
    route,
    model,
    fallbackMaxOutputTokens: 32,
    missingUsagePolicy: overrides.missingUsagePolicy ?? 'reserve',
  })
  return { ctx, reserve, settle, cancel, provision }
}

describe('account platform model route', () => {
  it('reserves before dispatch, hands off the account token, and settles before finish', async () => {
    const { ctx, reserve, settle } = await harness()
    const request = options()
    const order: string[] = []
    reserve.mockImplementation(async (input: { reservationId: string; amountMicros: number }) => {
      order.push('reserve')
      return { reservationId: input.reservationId, reservedMicros: input.amountMicros }
    })
    settle.mockImplementation((async () => { order.push('settle'); return {} }))
    const downstream = () => (async function* (): AsyncGenerator<StreamChunk> {
      order.push('dispatch')
      const token = await ctx.waterfall('llm-pi-ai/resolve-api-key', {
        provider: route,
        profile: {} as never,
        options: request,
      }, () => Promise.resolve(undefined))
      expect(token).toBe('sk_account_secret')
      yield { type: 'usage', usage: { inputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 2 } }
      order.push('inner-finish')
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()

    const chunks = await collect(ctx.waterfall('llm/stream', request, downstream))

    expect(order).toEqual(['reserve', 'dispatch', 'inner-finish', 'settle'])
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(reserve).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, actualMicros: 22 }))
  })

  it('keeps the account token when downstream model defaults clone the request', async () => {
    const { ctx } = await harness()
    const request = options()
    const downstream = () => (async function* (): AsyncGenerator<StreamChunk> {
      const defaulted = { ...request, maxTokens: 64 }
      const token = await ctx.waterfall('llm-pi-ai/resolve-api-key', {
        provider: route,
        profile: {} as never,
        options: defaulted,
      }, () => Promise.resolve(undefined))
      expect(token).toBe('sk_account_secret')
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()

    await collect(ctx.waterfall('llm/stream', request, downstream))
  })

  it('does not dispatch when the wallet cannot reserve the request', async () => {
    const reserve = vi.fn<(input: ReserveInput) => Promise<ReserveOutput>>(async () => {
      throw new Error('insufficient balance')
    })
    const { ctx } = await harness({ reserve })
    const downstream = vi.fn(() => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())

    await expect(collect(ctx.waterfall('llm/stream', options(), downstream))).rejects.toThrow('insufficient balance')
    expect(downstream).not.toHaveBeenCalled()
  })

  it('uses the authenticated owner directly without creating or reading a cloud Session', async () => {
    const resolveActive = vi.fn<(input: { userId: string }) => Promise<ActiveCredential>>(async () => ({
      token: 'sk_account_secret', route, model,
      inputPriceMicrosPerToken: 1, outputPriceMicrosPerToken: 8,
    }))
    const { ctx, reserve, settle } = await harness({ resolveActive })
    ctx.llm.registerAdapter([route], new class extends LlmAdapter {
      override stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        expect(request.sessionId).toBeUndefined()
        return (async function* (): AsyncGenerator<StreamChunk> {
          yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }
    }())

    const chunks = await collect(ctx.accountPlatform.streamForAccount(ownerId as never, {
      model, messages: [], maxTokens: 32,
    }))

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(resolveActive).toHaveBeenCalledWith({ userId: ownerId, route })
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId }))
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, actualMicros: 10 }))
  })

  it('keeps wallet operation keys within the 64-character limit for production session ids', async () => {
    const { ctx, reserve, settle } = await harness()
    await collect(ctx.waterfall('llm/stream', { ...options(), sessionId: productionLengthSessionId as never }, () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()))
    const reservationId = reserve.mock.calls[0]![0].reservationId
    const idempotencyKey = settle.mock.calls[0]![0].idempotencyKey
    expect(reservationId.length).toBeLessThanOrEqual(64)
    expect(idempotencyKey.length).toBeLessThanOrEqual(64)
  })

  it('reserves enough for provider-owned cached prefix tokens absent from request JSON', async () => {
    const { ctx, reserve, settle } = await harness()
    await collect(ctx.waterfall('llm/stream', options(), () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 15, outputTokens: 16, cacheReadTokens: 166 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()))
    expect(reserve.mock.calls[0]?.[0].amountMicros)
      .toBeGreaterThanOrEqual(settle.mock.calls[0]?.[0].actualMicros ?? Number.POSITIVE_INFINITY)
  })

  it('provisions a missing account token once and then resolves it', async () => {
    const resolveActive = vi.fn<(input: { userId: string }) => Promise<ActiveCredential | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ token: 'sk_repaired', route, model, inputPriceMicrosPerToken: 1, outputPriceMicrosPerToken: 8 })
    const { ctx, provision } = await harness({ resolveActive })
    const request = options()
    const downstream = () => (async function* (): AsyncGenerator<StreamChunk> {
      expect(await ctx.waterfall('llm-pi-ai/resolve-api-key', { provider: route, profile: {} as never, options: request }, () => Promise.resolve(undefined))).toBe('sk_repaired')
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()

    await collect(ctx.waterfall('llm/stream', request, downstream))
    expect(provision).toHaveBeenCalledWith({ userId: ownerId })
  })

  it('settles the full hold when usage is absent under the fail-safe policy', async () => {
    const { ctx, reserve, settle, cancel } = await harness({ missingUsagePolicy: 'reserve' })
    const request = options()
    await collect(ctx.waterfall('llm/stream', request, () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: 'failed' } } }
    })()))
    const reserveResult = reserve.mock.results[0]
    if (reserveResult?.type !== 'return') throw new TypeError('expected reserve to return')
    const reservedMicros = (await reserveResult.value).reservedMicros
    expect(settle.mock.calls[0]?.[0].actualMicros).toBe(reservedMicros)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('passes non-platform routes through without touching account services', async () => {
    const { ctx, reserve, settle, provision } = await harness()
    const chunks = await collect(ctx.waterfall('llm/stream', options('customer-byok'), () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()))
    expect(chunks).toHaveLength(1)
    expect(reserve).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
    expect(provision).not.toHaveBeenCalled()
  })

  it('fails closed for a platform request without an account-owned session', async () => {
    const { ctx, reserve } = await harness()
    const request = { ...options(), sessionId: 'unknown-session' as never }
    await expect(collect(ctx.waterfall('llm/stream', request, () => (async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()))).rejects.toThrow('account-owned session')
    expect(reserve).not.toHaveBeenCalled()
  })

  it('routes an owned custom model with its stored endpoint, model, and key without wallet billing', async () => {
    const resolveCustom = vi.fn(async ({ userId, customModelId }: { userId: string; customModelId: string }) => ({
      customModelId,
      userId,
      label: 'Private model',
      api: 'openai-responses' as const,
      baseURL: 'https://api.example.com/v1/',
      upstreamModel: 'upstream-model',
      revoked: null,
      apiKey: 'sk-custom',
    }))
    const { ctx, reserve } = await harness({ resolveCustom })
    const dispatched: Array<{ options: GenerateOptions; key: string | undefined }> = []
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream').mockImplementation(function (
      this: PiAiAdapter,
      request,
    ) {
      const config = (this as unknown as { config: PiAiAdapterOptions }).config
      return (async function* (): AsyncGenerator<StreamChunk> {
        const profile = config.profiles().get(request.provider)
        if (profile === undefined) throw new Error('missing custom profile')
        dispatched.push({
          options: request,
          key: await config.resolveApiKey(request.provider, profile, request),
        })
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })
    try {
      const chunks = await collect(ctx.llm.stream({
        ...options('xiaowei-custom'),
        model: 'cm_0123456789abcdef',
      }))
      expect(chunks).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
      expect(resolveCustom).toHaveBeenCalledWith({
        userId: ownerId,
        customModelId: 'cm_0123456789abcdef',
      })
      expect(dispatched).toHaveLength(1)
      const attempt = dispatched[0]
      expect(attempt?.options).toMatchObject({
        provider: 'xiaowei-custom',
        model: 'upstream-model',
        sessionId: 'session-alice',
      })
      expect(attempt?.key).toBe('sk-custom')
      expect(reserve).not.toHaveBeenCalled()
    } finally {
      stream.mockRestore()
    }
  })

  it('rejects a custom model that is not owned by the addressed session', async () => {
    const { ctx, reserve } = await harness({ resolveCustom: vi.fn(async () => undefined) })
    await expect(collect(ctx.llm.stream({
      ...options('xiaowei-custom'),
      model: 'cm_ffffffffffffffff',
    }))).resolves.toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'CUSTOM_MODEL_UNAVAILABLE', message: 'custom model is unavailable' },
      },
    }])
    expect(reserve).not.toHaveBeenCalled()
  })

  it('rejects a custom endpoint that resolves to a metadata address before dispatch', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as never)
    const resolveCustom = vi.fn(async ({ userId, customModelId }: { userId: string; customModelId: string }) => ({
      customModelId,
      userId,
      label: 'Private model',
      api: 'openai-responses' as const,
      baseURL: 'https://metadata-alias.example/v1/',
      upstreamModel: 'upstream-model',
      revoked: null,
      apiKey: 'sk-custom',
    }))
    const { ctx, reserve } = await harness({ resolveCustom })
    const stream = vi.spyOn(PiAiAdapter.prototype, 'stream')
    try {
      await expect(collect(ctx.llm.stream({
        ...options('xiaowei-custom'),
        model: 'cm_0123456789abcdef',
      }))).resolves.toEqual([{
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'CUSTOM_MODEL_URL_INVALID',
            message: 'custom model base URL resolves to a private or metadata address',
          },
        },
      }])
      expect(stream).not.toHaveBeenCalled()
      expect(reserve).not.toHaveBeenCalled()
    } finally {
      stream.mockRestore()
    }
  })
})
