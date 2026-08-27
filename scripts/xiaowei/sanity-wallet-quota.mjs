/**
 * sanity-wallet-quota.mjs
 *
 * End-to-end probe of the wallet seam against a real on-disk SQLite ledger.
 * Exercises the full ledger lifecycle:
 *
 *   1. Fresh user has zero balance (no row, no fake 0).
 *   2. `setQuota(100 CNY, 'test')` writes one `set-quota` row.
 *   3. `credit(+5 CNY, 'topup')` appends a second.
 *   4. `debit(2 CNY, 'debit')` appends a third; balance == 103 CNY.
 *   5. `debit(200 CNY)` over the balance throws WalletError INSUFFICIENT_BALANCE
 *      and the ledger remains untouched.
 *   6. `refreshDaily(key='YYYY-MM-DD')` adds `dailyRefreshMicros` (5 CNY);
 *      a second call with the same idempotency key returns the same balance
 *      (UNIQUE partial index).
 *   7. `listLedger` returns the rows newest-first.
 *   8. Persistence survives a handle restart.
 *
 * Run: `node scripts/xiaowei/sanity-wallet-quota.mjs` from the repo root.
 *
 * Exit codes: 0 PASS, 1 FAIL with a one-line reason on stderr.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'
import LocalWalletProvider, { WalletError } from '@deepseek-ai/dsh-account-wallet'

function die(reason) {
  console.error(`sanity-wallet-quota: FAIL — ${reason}`)
  process.exit(1)
}

/** Cast a plain string to the wallet package's `UserId` brand. */
function asUserId(value) {
  return value
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-wallet-quota-'))
  const dbPath = join(home, 'wallet.sqlite')
  console.log(`sanity-wallet-quota: home=${home}`)

  const ctx = new Context()
  await ctx.plugin(LocalWalletProvider, {
    path: dbPath,
    welcomeBonusMicros: 20_000_000,
    dailyRefreshMicros: 5_000_000,
  })
  const wallet = ctx.wallet
  const userId = asUserId(`u_${randomUUID().replace(/-/g, '').slice(0, 16)}`)
  const cny = (micros) => micros / 1_000_000

  // Step 1: fresh user has zero balance
  const zero = await wallet.get({ userId })
  if (zero.balanceMicros !== 0) {
    await rm(home, { recursive: true, force: true })
    die(`fresh-user balance should be 0, got ${zero.balanceMicros}`)
  }
  console.log('sanity-wallet-quota: fresh user → 0 micros')

  // Step 2: setQuota(100 CNY)
  const afterQuota = await wallet.setQuota({
    userId,
    balanceMicros: 100_000_000,
    reason: 'set-quota',
  })
  if (afterQuota.balanceMicros !== 100_000_000) {
    await rm(home, { recursive: true, force: true })
    die(`setQuota balance mismatch: got ${afterQuota.balanceMicros}`)
  }
  console.log(`sanity-wallet-quota: setQuota → ${cny(afterQuota.balanceMicros)} CNY`)

  // Step 3: credit +5 CNY
  const afterCredit = await wallet.credit({ userId, amountMicros: 5_000_000, reason: 'topup' })
  if (afterCredit.balanceMicros !== 105_000_000) {
    await rm(home, { recursive: true, force: true })
    die(`credit balance mismatch: got ${afterCredit.balanceMicros}`)
  }
  console.log(`sanity-wallet-quota: credit +5 → ${cny(afterCredit.balanceMicros)} CNY`)

  // Step 4: debit 2 CNY
  const afterDebit = await wallet.debit({ userId, amountMicros: 2_000_000, reason: 'debit' })
  if (afterDebit.balanceMicros !== 103_000_000) {
    await rm(home, { recursive: true, force: true })
    die(`debit balance mismatch: got ${afterDebit.balanceMicros}`)
  }
  console.log(`sanity-wallet-quota: debit 2 → ${cny(afterDebit.balanceMicros)} CNY`)

  // Step 5: debit over balance throws INSUFFICIENT_BALANCE; ledger untouched
  const balanceBefore = afterDebit.balanceMicros
  try {
    await wallet.debit({ userId, amountMicros: 200_000_000, reason: 'debit' })
    await rm(home, { recursive: true, force: true })
    die(`over-balance debit did not throw`)
  } catch (error) {
    if (!(error instanceof WalletError) || error.code !== 'INSUFFICIENT_BALANCE') {
      await rm(home, { recursive: true, force: true })
      die(`over-balance debit threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  const stillSame = await wallet.get({ userId })
  if (stillSame.balanceMicros !== balanceBefore) {
    await rm(home, { recursive: true, force: true })
    die(`balance moved after failed debit: ${stillSame.balanceMicros} vs ${balanceBefore}`)
  }
  console.log('sanity-wallet-quota: over-balance debit → INSUFFICIENT_BALANCE, ledger intact')

  // Step 6: refreshDaily with idempotency key
  const dateKey = new Date().toISOString().slice(0, 10)
  const afterRefresh = await wallet.refreshDaily({ userId, idempotencyKey: dateKey })
  if (afterRefresh.balanceMicros !== balanceBefore + 5_000_000) {
    await rm(home, { recursive: true, force: true })
    die(`refreshDaily balance mismatch: got ${afterRefresh.balanceMicros}`)
  }
  const again = await wallet.refreshDaily({ userId, idempotencyKey: dateKey })
  if (again.balanceMicros !== afterRefresh.balanceMicros) {
    await rm(home, { recursive: true, force: true })
    die(`refreshDaily idempotency failed: ${again.balanceMicros} vs ${afterRefresh.balanceMicros}`)
  }
  console.log(`sanity-wallet-quota: refreshDaily → ${cny(afterRefresh.balanceMicros)} CNY (idempotent on ${dateKey})`)

  // Step 7: listLedger returns rows newest-first
  const ledger = await wallet.listLedger({ userId })
  if (ledger.length < 4) {
    await rm(home, { recursive: true, force: true })
    die(`listLedger returned ${ledger.length} rows; expected ≥ 4`)
  }
  for (let i = 1; i < ledger.length; i += 1) {
    if (ledger[i - 1].createdAt < ledger[i].createdAt) {
      await rm(home, { recursive: true, force: true })
      die(`listLedger not newest-first at index ${i}`)
    }
  }
  console.log(`sanity-wallet-quota: listLedger → ${ledger.length} rows newest-first`)

  // Step 8: persistence survives a handle restart
  const ctx2 = new Context()
  await ctx2.plugin(LocalWalletProvider, {
    path: dbPath,
    welcomeBonusMicros: 20_000_000,
    dailyRefreshMicros: 5_000_000,
  })
  const afterRestart = await ctx2.wallet.get({ userId })
  if (afterRestart.balanceMicros !== afterRefresh.balanceMicros) {
    await rm(home, { recursive: true, force: true })
    die(`restart balance mismatch: ${afterRestart.balanceMicros} vs ${afterRefresh.balanceMicros}`)
  }
  console.log('sanity-wallet-quota: balance survives a handle restart')

  // Step 9: grantWelcomeBonus for a fresh user applies the configured welcome
  const other = asUserId(`u_${randomUUID().replace(/-/g, '').slice(0, 16)}`)
  const welcomed = await wallet.grantWelcomeBonus({ userId: other })
  if (welcomed.balanceMicros !== 20_000_000) {
    await rm(home, { recursive: true, force: true })
    die(`grantWelcomeBonus balance mismatch: got ${welcomed.balanceMicros}`)
  }
  console.log('sanity-wallet-quota: grantWelcomeBonus → 20 CNY')

  await rm(home, { recursive: true, force: true })
  console.log('sanity-wallet-quota: PASS')
}

main().catch(async (error) => {
  console.error('sanity-wallet-quota: FAIL — unexpected throw')
  console.error(error)
  process.exit(1)
})