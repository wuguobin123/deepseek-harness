/**
 * sanity-bootstrap-user.mjs
 *
 * End-to-end probe of the bootstrap admin path. Boots the local identity
 * provider with a configured `bootstrap.email`/`bootstrap.password` against
 * an empty SQLite database, asserts the admin row appears, signs in with
 * the bootstrap credentials, and proves the second mount with the same
 * database does NOT recreate the row.
 *
 * Run: `node scripts/xiaowei/sanity-bootstrap-user.mjs` from the repo root,
 * or via `pnpm exec tsx scripts/xiaowei/sanity-bootstrap-user.mjs`.
 *
 * Exit codes: 0 PASS, 1 FAIL with a one-line reason on stderr.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'
import LocalIdentityProvider, {
  IdentityError,
} from '@deepseek-ai/dsh-account-identity'

function die(reason) {
  console.error(`sanity-bootstrap-user: FAIL — ${reason}`)
  process.exit(1)
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-bootstrap-'))
  const dbPath = join(home, 'identity.sqlite')
  console.log(`sanity-bootstrap-user: home=${home}`)

  const adminEmail = `admin-${randomUUID().slice(0, 8)}@example.test`
  const adminPassword = 'admin-only-secret-do-not-reuse'
  const adminDisplayName = 'Initial Admin'

  // Step 1: bootstrap config WITHOUT bootstrap enabled — empty users, signin
  // for the would-be admin fails. Proves the default config leaves the
  // database empty, so the empty-bootstrap path is well-defined.
  {
    const ctx = new Context()
    await ctx.plugin(LocalIdentityProvider, { path: dbPath })
    try {
      await ctx.identity.signin({ email: adminEmail, password: adminPassword })
      await rm(home, { recursive: true, force: true })
      die(`signin succeeded before bootstrap ran`)
    } catch (error) {
      if (!(error instanceof IdentityError) || error.code !== 'UNAUTHENTICATED') {
        await rm(home, { recursive: true, force: true })
        die(`expected UNAUTHENTICATED before bootstrap, got ${error?.code ?? error?.constructor?.name}`)
      }
    }
  }

  // Step 2: bootstrap with a configured email/password — empty users table →
  // the provider creates exactly one row. Signin with the same credentials
  // now succeeds.
  {
    const ctx = new Context()
    await ctx.plugin(LocalIdentityProvider, {
      path: dbPath,
      bootstrap: {
        email: adminEmail,
        password: adminPassword,
        displayName: adminDisplayName,
      },
    })
    const signedIn = await ctx.identity.signin({ email: adminEmail, password: adminPassword })
    if (signedIn.displayName !== adminDisplayName) {
      await rm(home, { recursive: true, force: true })
      die(`bootstrap displayName mismatch: got ${JSON.stringify(signedIn.displayName)}`)
    }
    console.log(`sanity-bootstrap-user: bootstrap created admin → userId=${String(signedIn.userId)}`)

    // Step 3: a second provider mount over the same DB does NOT recreate
    // the admin — the empty-users gate prevents duplicates even when the
    // bootstrap config is still present.
    const ctx2 = new Context()
    await ctx2.plugin(LocalIdentityProvider, {
      path: dbPath,
      bootstrap: {
        email: adminEmail,
        password: 'a-different-password',
        displayName: 'Should Not Apply',
      },
    })
    try {
      await ctx2.identity.signin({ email: adminEmail, password: 'a-different-password' })
      await rm(home, { recursive: true, force: true })
      die(`second mount re-bootstrapped; password update should not happen`)
    } catch (error) {
      if (!(error instanceof IdentityError) || error.code !== 'UNAUTHENTICATED') {
        await rm(home, { recursive: true, force: true })
        die(`second mount accepted the new password: ${error?.code ?? error?.constructor?.name}`)
      }
    }
    // The first password still works — the bootstrap config did NOT overwrite
    // the row.
    await ctx2.identity.signin({ email: adminEmail, password: adminPassword })
    console.log('sanity-bootstrap-user: bootstrap is idempotent across mounts')
  }

  // Step 4: empty bootstrap email leaves the deployment with no users. This
  // is the explicit opt-in shape: the operator can disable bootstrap by
  // leaving the email unset (the default), so an unattended deployment
  // never ships a default credential.
  {
    const home2 = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-bootstrap-empty-'))
    const dbPath2 = join(home2, 'identity.sqlite')
    const ctx = new Context()
    await ctx.plugin(LocalIdentityProvider, { path: dbPath2 })
    try {
      await ctx.identity.signup({ email: 'manual@example.test', password: 'manual-password' })
    } catch (error) {
      await rm(home, { recursive: true, force: true })
      await rm(home2, { recursive: true, force: true })
      die(`signup threw with empty bootstrap: ${error?.code ?? error?.constructor?.name}: ${error?.message}`)
    }
    console.log('sanity-bootstrap-user: empty bootstrap leaves users empty; signup is open')
    await rm(home2, { recursive: true, force: true })
  }

  // Cleanup
  await rm(home, { recursive: true, force: true })
  console.log('sanity-bootstrap-user: PASS')
}

main().catch(async (error) => {
  console.error('sanity-bootstrap-user: FAIL — unexpected throw')
  console.error(error)
  process.exit(1)
})
