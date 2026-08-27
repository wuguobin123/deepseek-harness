/**
 * sanity-email-code.mjs
 *
 * End-to-end probe of the email-verification seam against a real on-disk
 * SQLite database. Exercises the public API surface (`requestCode` /
 * `verifyCode`) under the LoggingEmailSender so the run stays keyless and
 * CI-friendly.
 *
 * The LoggingEmailSender writes the raw 6-digit code to a captured WARN
 * line; this script taps ctx.logger.warn to fish the code back out.
 *
 *   1. Fresh email gets a code; `requestCode` resolves with ttl + cooldown.
 *   2. Resend within cooldown throws RESEND_COOLDOWN.
 *   3. Wrong code throws WRONG_CODE; remaining attempts decrement.
 *   4. After maxAttempts wrong codes the email locks (CODE_LOCKED).
 *   5. Locked row refuses even with the correct code until lockoutSeconds
 *      elapses.
 *   6. Successful verify deletes the row so the same code cannot be reused.
 *   7. Expired codes (short TTL) throw CODE_EXPIRED.
 *   8. Unknown email throws CODE_NOT_FOUND.
 *   9. Disabled seam (`enabled: false`) makes verifyCode a pass-through.
 *
 * Run: `node scripts/xiaowei/sanity-email-code.mjs` from the repo root.
 *
 * Exit codes: 0 PASS, 1 FAIL with a one-line reason on stderr.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'
import LocalEmailVerificationProvider, { EmailVerificationError } from '@deepseek-ai/dsh-account-email-verification'

function die(reason) {
  console.error(`sanity-email-code: FAIL — ${reason}`)
  process.exit(1)
}

/**
 * Install a logger on the Cordis context whose warn lines we can intercept.
 * Each `ctx.logger.warn` invocation appends to `warnLines`, and a
 * successful requestCode therefore leaves one line per code issued.
 *
 * Must run BEFORE `ctx.plugin(...)` — `LoggingEmailSender` captures the
 * logger reference at construction time, so the post-load monkey-patch
 * would not be visible to the sender.
 */
function installCodeCapture(ctx) {
  const warnLines = []
  const original = ctx.logger
  const originalWarn = original.warn.bind(original)
  original.warn = (format, ...args) => {
    const line = typeof format === 'string'
      ? format.replace(/%[sdj]/g, () => String(args.shift()))
      : String(format)
    warnLines.push(line)
    originalWarn(format, ...args)
  }
  return {
    readCodeFor(email) {
      for (let i = warnLines.length - 1; i >= 0; i -= 1) {
        const line = warnLines[i]
        if (line.includes(`email=${email}`)) {
          const match = line.match(/code=(\d{6})/)
          if (match !== null) return match[1]
        }
      }
      return undefined
    },
  }
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-email-code-'))
  const dbPath = join(home, 'email-verification.sqlite')
  console.log(`sanity-email-code: home=${home}`)

  const ctx = new Context()
  const capture = installCodeCapture(ctx)
  await ctx.plugin(LocalEmailVerificationProvider, {
    path: dbPath,
    transportKind: 'logging',
    ttlSeconds: 600,
    resendCooldownSeconds: 60,
    maxSendsPerHour: 10,
    maxAttemptsBeforeLock: 5,
    lockoutSeconds: 1800,
  })
  const emailVerification = ctx.emailVerification

  const email = `user-${randomUUID().slice(0, 8)}@example.test`

  // Step 1: fresh request returns ttl + retryAfter
  const requested = await emailVerification.requestCode({ email })
  if (requested.expiresInSeconds !== 600) {
    await rm(home, { recursive: true, force: true })
    die(`expiresInSeconds mismatch: got ${requested.expiresInSeconds}`)
  }
  if (requested.retryAfterSeconds !== 60) {
    await rm(home, { recursive: true, force: true })
    die(`retryAfterSeconds mismatch: got ${requested.retryAfterSeconds}`)
  }
  const firstCode = capture.readCodeFor(email)
  if (firstCode === undefined) {
    await rm(home, { recursive: true, force: true })
    die(`code was not captured from LoggingEmailSender output`)
  }
  console.log('sanity-email-code: requestCode → ttl=600 retryAfter=60')

  // Step 2: resend within cooldown throws RESEND_COOLDOWN
  try {
    await emailVerification.requestCode({ email })
    await rm(home, { recursive: true, force: true })
    die(`resend within cooldown did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'RESEND_COOLDOWN') {
      await rm(home, { recursive: true, force: true })
      die(`resend within cooldown threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: resend within 60s → RESEND_COOLDOWN')

  // Step 3 + 4: 5 wrong codes → CODE_LOCKED
  for (let i = 0; i < 4; i += 1) {
    try {
      await emailVerification.verifyCode({ email, code: '000000' })
      await rm(home, { recursive: true, force: true })
      die(`wrong code #${i + 1} did not throw`)
    } catch (error) {
      if (!(error instanceof EmailVerificationError) || error.code !== 'WRONG_CODE') {
        await rm(home, { recursive: true, force: true })
        die(`wrong code #${i + 1} threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
      }
    }
  }
  try {
    await emailVerification.verifyCode({ email, code: '000000' })
    await rm(home, { recursive: true, force: true })
    die(`5th wrong code did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'CODE_LOCKED') {
      await rm(home, { recursive: true, force: true })
      die(`5th wrong code threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: 5 wrong codes → CODE_LOCKED')

  // Step 5: correct code while locked still throws CODE_LOCKED
  try {
    await emailVerification.verifyCode({ email, code: firstCode })
    await rm(home, { recursive: true, force: true })
    die(`correct code while locked did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'CODE_LOCKED') {
      await rm(home, { recursive: true, force: true })
      die(`correct code while locked threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: correct code while locked → CODE_LOCKED')

  // Step 6: success on a fresh email deletes the row (one-shot)
  const other = `other-${randomUUID().slice(0, 8)}@example.test`
  await emailVerification.requestCode({ email: other })
  const otherCode = capture.readCodeFor(other)
  if (otherCode === undefined) {
    await rm(home, { recursive: true, force: true })
    die(`second-email code not captured`)
  }
  const ok = await emailVerification.verifyCode({ email: other, code: otherCode })
  if (ok !== true) {
    await rm(home, { recursive: true, force: true })
    die(`successful verifyCode did not return true`)
  }
  try {
    await emailVerification.verifyCode({ email: other, code: otherCode })
    await rm(home, { recursive: true, force: true })
    die(`reused code did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'CODE_NOT_FOUND') {
      await rm(home, { recursive: true, force: true })
      die(`reused code threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: verify success → row deleted; reuse → CODE_NOT_FOUND')

  // Step 7: short TTL → expired code
  const ctx2 = new Context()
  const capture2 = installCodeCapture(ctx2)
  await ctx2.plugin(LocalEmailVerificationProvider, {
    path: join(home, 'email-verification-ttl.sqlite'),
    transportKind: 'logging',
    ttlSeconds: 30,
    resendCooldownSeconds: 0,
    maxSendsPerHour: 100,
    maxAttemptsBeforeLock: 5,
    lockoutSeconds: 1800,
  })
  const ttlEmail = `ttl-${randomUUID().slice(0, 8)}@example.test`
  await ctx2.emailVerification.requestCode({ email: ttlEmail })
  const ttlCode = capture2.readCodeFor(ttlEmail)
  if (ttlCode === undefined) {
    await rm(home, { recursive: true, force: true })
    die(`TTL-test code not captured`)
  }
  // Wait past the 30-second window. Production deployments use the TTL
  // for window arithmetic; here we just sleep.
  await new Promise((resolve) => setTimeout(resolve, 31_000))
  try {
    await ctx2.emailVerification.verifyCode({ email: ttlEmail, code: ttlCode })
    await rm(home, { recursive: true, force: true })
    die(`expired code did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'CODE_EXPIRED') {
      await rm(home, { recursive: true, force: true })
      die(`expired code threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: TTL-expired code → CODE_EXPIRED')

  // Step 8: unknown email throws CODE_NOT_FOUND
  try {
    await emailVerification.verifyCode({ email: 'nobody@example.test', code: '123456' })
    await rm(home, { recursive: true, force: true })
    die(`unknown-email verify did not throw`)
  } catch (error) {
    if (!(error instanceof EmailVerificationError) || error.code !== 'CODE_NOT_FOUND') {
      await rm(home, { recursive: true, force: true })
      die(`unknown-email verify threw ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
  }
  console.log('sanity-email-code: unknown email → CODE_NOT_FOUND')

  // Step 9: disabled seam is a pass-through for verifyCode
  const ctx3 = new Context()
  await ctx3.plugin(LocalEmailVerificationProvider, {
    path: join(home, 'email-verification-off.sqlite'),
    enabled: false,
  })
  const passthrough = await ctx3.emailVerification.verifyCode({
    email: 'whatever@example.test',
    code: '000000',
  })
  if (passthrough !== true) {
    await rm(home, { recursive: true, force: true })
    die(`disabled verifyCode should resolve true`)
  }
  console.log('sanity-email-code: disabled seam → verifyCode pass-through')

  await rm(home, { recursive: true, force: true })
  console.log('sanity-email-code: PASS')
}

main().catch(async (error) => {
  console.error('sanity-email-code: FAIL — unexpected throw')
  console.error(error)
  process.exit(1)
})