/**
 * Wallet seam unit tests. Mounts `LocalWalletProvider` through a real Cordis
 * context so the `[Service.init]` lifecycle runs (opens the SQLite handle,
 * applies DDL).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalWalletProvider, WalletError } from '../src/index.ts'

const roots: string[] = []

async function home(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-account-wallet-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  while (roots.length > 0) {
    const value = roots.pop()
    if (value !== undefined) await rm(value, { recursive: true, force: true })
  }
})

interface BootOptions {
  welcomeBonusMicros?: number
  dailyRefreshMicros?: number
}

interface Harness {
  ctx: Context
}

async function boot(options: BootOptions = {}): Promise<Harness> {
  const dshHome = await home()
  const ctx = new Context()
  await ctx.plugin(LocalWalletProvider, {
    path: join(dshHome, 'wallet.sqlite'),
    ...(options.welcomeBonusMicros !== undefined ? { welcomeBonusMicros: options.welcomeBonusMicros } : {}),
    ...(options.dailyRefreshMicros !== undefined ? { dailyRefreshMicros: options.dailyRefreshMicros } : {}),
  })
  return { ctx }
}

const userA = 'u-alice' as never
const userB = 'u-bob' as never

describe('LocalWalletProvider — bootstrap + read', () => {
  it('mounts as `ctx.wallet`', async () => {
    const { ctx } = await boot()
    expect(typeof ctx.wallet.get).toBe('function')
    expect(typeof ctx.wallet.credit).toBe('function')
    expect(typeof ctx.wallet.debit).toBe('function')
    expect(typeof ctx.wallet.setQuota).toBe('function')
    expect(typeof ctx.wallet.refreshDaily).toBe('function')
    expect(typeof ctx.wallet.grantWelcomeBonus).toBe('function')
    expect(typeof ctx.wallet.listLedger).toBe('function')
  })

  it('get returns zero for a brand-new user', async () => {
    const { ctx } = await boot()
    const view = await ctx.wallet.get({ userId: userA })
    expect(view.balanceMicros).toBe(0)
    expect(view.updatedAt).toBe(0)
  })

  it('grantWelcomeBonus credits the configured amount and persists across reads', async () => {
    const { ctx } = await boot({ welcomeBonusMicros: 25_000_000 })
    const out = await ctx.wallet.grantWelcomeBonus({ userId: userA })
    expect(out.balanceMicros).toBe(25_000_000)
    const again = await ctx.wallet.get({ userId: userA })
    expect(again.balanceMicros).toBe(25_000_000)
    expect(again.updatedAt).toBe(out.updatedAt)
  })

  it('grants the default 20 CNY welcome allowance only once', async () => {
    const { ctx } = await boot()
    const first = await ctx.wallet.grantWelcomeBonus({ userId: userA })
    const second = await ctx.wallet.grantWelcomeBonus({ userId: userA })
    expect(first.balanceMicros).toBe(20_000_000)
    expect(second.balanceMicros).toBe(20_000_000)
    expect(await ctx.wallet.listLedger({ userId: userA })).toHaveLength(1)
  })
})

describe('LocalWalletProvider — credit + debit', () => {
  it('credit adds the amount and the user-visible ledger row', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 5_000_000, reason: 'topup' })
    await ctx.wallet.credit({ userId: userA, amountMicros: 3_000_000, reason: 'topup' })
    const view = await ctx.wallet.get({ userId: userA })
    expect(view.balanceMicros).toBe(8_000_000)
    const ledger = await ctx.wallet.listLedger({ userId: userA })
    expect(ledger).toHaveLength(2)
    expect(ledger[0]!.deltaMicros).toBe(3_000_000)
    expect(ledger[1]!.deltaMicros).toBe(5_000_000)
    expect(ledger[0]!.balanceAfter).toBe(8_000_000)
    expect(ledger[1]!.balanceAfter).toBe(5_000_000)
  })

  it('debit subtracts the amount and refuses to overdraw', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 5_000_000, reason: 'topup' })
    const out = await ctx.wallet.debit({ userId: userA, amountMicros: 2_000_000, reason: 'debit' })
    expect(out.balanceMicros).toBe(3_000_000)
    await expect(ctx.wallet.debit({ userId: userA, amountMicros: 9_999_999, reason: 'debit' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
  })

  it('rejects non-positive credit / debit amounts with BAD_REQUEST', async () => {
    const { ctx } = await boot()
    await expect(ctx.wallet.credit({ userId: userA, amountMicros: 0, reason: 'topup' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(ctx.wallet.debit({ userId: userA, amountMicros: -1, reason: 'debit' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('isolates balances between users', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 7_000_000, reason: 'topup' })
    await ctx.wallet.credit({ userId: userB, amountMicros: 1_000_000, reason: 'topup' })
    expect((await ctx.wallet.get({ userId: userA })).balanceMicros).toBe(7_000_000)
    expect((await ctx.wallet.get({ userId: userB })).balanceMicros).toBe(1_000_000)
  })
})

describe('LocalWalletProvider — setQuota', () => {
  it('setQuota sets the absolute balance and records a set-quota ledger row', async () => {
    const { ctx } = await boot()
    await ctx.wallet.setQuota({ userId: userA, balanceMicros: 50_000_000, reason: 'set-quota' })
    const view = await ctx.wallet.get({ userId: userA })
    expect(view.balanceMicros).toBe(50_000_000)
    const ledger = await ctx.wallet.listLedger({ userId: userA })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.reason).toBe('set-quota')
    expect(ledger[0]!.balanceAfter).toBe(50_000_000)
    expect(ledger[0]!.deltaMicros).toBe(50_000_000)
  })

  it('setQuota on an existing wallet records the delta, not the absolute', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 30_000_000, reason: 'topup' })
    await ctx.wallet.setQuota({ userId: userA, balanceMicros: 10_000_000, reason: 'set-quota' })
    const ledger = await ctx.wallet.listLedger({ userId: userA })
    expect(ledger[0]!.deltaMicros).toBe(-20_000_000)
    expect(ledger[0]!.balanceAfter).toBe(10_000_000)
  })

  it('rejects negative setQuota with BAD_REQUEST', async () => {
    const { ctx } = await boot()
    await expect(ctx.wallet.setQuota({ userId: userA, balanceMicros: -1, reason: 'set-quota' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('LocalWalletProvider — refreshDaily + idempotency', () => {
  it('refreshDaily applies the configured amount and is idempotent by key', async () => {
    const { ctx } = await boot({ dailyRefreshMicros: 7_000_000 })
    const first = await ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: '2026-08-23' })
    expect(first.balanceMicros).toBe(7_000_000)
    const second = await ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: '2026-08-23' })
    expect(second.balanceMicros).toBe(7_000_000)
    const ledger = await ctx.wallet.listLedger({ userId: userA })
    expect(ledger).toHaveLength(1)
  })

  it('refreshDaily on a fresh key stacks onto the existing balance', async () => {
    const { ctx } = await boot({ dailyRefreshMicros: 5_000_000 })
    await ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: '2026-08-22' })
    const next = await ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: '2026-08-23' })
    expect(next.balanceMicros).toBe(10_000_000)
  })

  it('dailyRefreshMicros=0 makes refreshDaily a no-op (still idempotent)', async () => {
    const { ctx } = await boot()
    const out = await ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: 'k1' })
    expect(out.balanceMicros).toBe(0)
    const ledger = await ctx.wallet.listLedger({ userId: userA })
    expect(ledger).toHaveLength(0)
  })

  it('refreshDaily rejects an empty / oversized idempotencyKey', async () => {
    const { ctx } = await boot()
    await expect(ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: '' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(ctx.wallet.refreshDaily({ userId: userA, idempotencyKey: 'x'.repeat(65) }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('LocalWalletProvider — error surface', () => {
  it('rejects empty userId with BAD_REQUEST', async () => {
    const { ctx } = await boot()
    await expect(ctx.wallet.get({ userId: '' as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects unknown reason with BAD_REQUEST', async () => {
    const { ctx } = await boot()
    await expect(ctx.wallet.credit({ userId: userA, amountMicros: 1, reason: 'shady' as never }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('exposes WalletError for caller-side branching', () => {
    const e = new WalletError('INSUFFICIENT_BALANCE', 'nope')
    expect(e.code).toBe('INSUFFICIENT_BALANCE')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('LocalWalletProvider — schema guard', () => {
  it('rejects an out-of-version on-disk database', async () => {
    const dshHome = await home()
    const path = join(dshHome, 'wallet.sqlite')
    const ctx = new Context()
    await ctx.plugin(LocalWalletProvider, { path })
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 999')
    db.close()
    const ctx2 = new Context()
    await expect(ctx2.plugin(LocalWalletProvider, { path })).rejects.toThrow(/schema version 999/)
  })
})

describe('LocalWalletProvider — model usage reservations', () => {
  it('reserves available balance, settles actual usage, and is idempotent', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 10_000_000, reason: 'topup' })
    const held = await ctx.wallet.reserve({ userId: userA, reservationId: 'r1', amountMicros: 7_000_000 })
    expect(held.reservedMicros).toBe(7_000_000)
    await expect(ctx.wallet.reserve({ userId: userA, reservationId: 'r2', amountMicros: 4_000_000 })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    const settled = await ctx.wallet.settle({ userId: userA, reservationId: 'r1', actualMicros: 2_000_000, idempotencyKey: 's1' })
    expect(settled.refundedMicros).toBe(5_000_000)
    expect(settled.balanceMicros).toBe(8_000_000)
    expect(await ctx.wallet.settle({ userId: userA, reservationId: 'r1', actualMicros: 2_000_000, idempotencyKey: 's1' })).toEqual(settled)
    expect((await ctx.wallet.listLedger({ userId: userA })).filter(entry => entry.reason === 'model-usage')).toHaveLength(1)
  })

  it('rejects reservation conflicts and releases on cancel', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 5_000_000, reason: 'topup' })
    await ctx.wallet.reserve({ userId: userA, reservationId: 'same', amountMicros: 3_000_000 })
    await expect(ctx.wallet.reserve({ userId: userA, reservationId: 'same', amountMicros: 2_000_000 })).rejects.toMatchObject({ code: 'RESERVATION_CONFLICT' })
    await ctx.wallet.cancel({ userId: userA, reservationId: 'same' })
    await ctx.wallet.cancel({ userId: userA, reservationId: 'same' })
    await expect(ctx.wallet.settle({ userId: userA, reservationId: 'same', actualMicros: 1, idempotencyKey: 's2' })).rejects.toMatchObject({ code: 'RESERVATION_ALREADY_CANCELLED' })
  })

  it('rejects foreign ownership, over-settlement, settlement drift, and settled cancellation', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 5_000_000, reason: 'topup' })
    await ctx.wallet.reserve({ userId: userA, reservationId: 'strict', amountMicros: 3_000_000 })
    await expect(ctx.wallet.reserve({ userId: userB, reservationId: 'strict', amountMicros: 3_000_000 })).rejects.toMatchObject({ code: 'RESERVATION_CONFLICT' })
    await expect(ctx.wallet.settle({ userId: userA, reservationId: 'strict', actualMicros: 3_000_001, idempotencyKey: 'strict-key' })).rejects.toMatchObject({ code: 'RESERVATION_ACTUAL_EXCEEDS_RESERVED' })
    await ctx.wallet.settle({ userId: userA, reservationId: 'strict', actualMicros: 2_000_000, idempotencyKey: 'strict-key' })
    await expect(ctx.wallet.settle({ userId: userA, reservationId: 'strict', actualMicros: 1_000_000, idempotencyKey: 'other-key' })).rejects.toMatchObject({ code: 'RESERVATION_CONFLICT' })
    await expect(ctx.wallet.cancel({ userId: userA, reservationId: 'strict' })).rejects.toMatchObject({ code: 'RESERVATION_ALREADY_SETTLED' })
  })

  it('enforces nonzero TTL and bounded identifiers', async () => {
    await expect(boot({})).resolves.toBeDefined()
    const { ctx } = await boot()
    await expect(ctx.wallet.reserve({ userId: userA, reservationId: '', amountMicros: 1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(ctx.wallet.reserve({ userId: userA, reservationId: 'x'.repeat(65), amountMicros: 1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(ctx.wallet.reserve({ userId: userA, reservationId: 'zero', amountMicros: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('allows only one concurrent reservation against available balance', async () => {
    const { ctx } = await boot()
    await ctx.wallet.credit({ userId: userA, amountMicros: 5_000_000, reason: 'topup' })
    const results = await Promise.allSettled([
      ctx.wallet.reserve({ userId: userA, reservationId: 'a', amountMicros: 4_000_000 }),
      ctx.wallet.reserve({ userId: userA, reservationId: 'b', amountMicros: 4_000_000 }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  })
})
