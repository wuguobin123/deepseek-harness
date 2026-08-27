import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, LocalIdentityProvider } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})
async function boot(config: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-invite-')); roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LocalIdentityProvider, { path: join(root, 'identity.sqlite'), bootstrap: { email: 'admin@example.com', password: 'admin-pass' }, ...config })
  const owner = await ctx.identity.signin({ email: 'admin@example.com', password: 'admin-pass' })
  return { ctx, owner, path: join(root, 'identity.sqlite') }
}

describe('identity invitations', () => {
  it('defaults the validation cohort to 100 accounts and three invitations', () => {
    expect(Config({ path: ':memory:' })).toMatchObject({
      maxUsers: 100,
      maxInvitationsPerUser: 3,
    })
  })

  it('lists active codes for their owner and masks them after consumption', async () => {
    const { ctx, owner } = await boot({ invitationPepper: 'test-pepper' })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    expect((await ctx.identity.listInvitations({ ownerId: owner.userId }))[0]).toMatchObject({
      invitationId: made.invitationId,
      code: made.code,
      codeMask: `••••${made.code.slice(-4)}`,
    })
    expect((await ctx.identity.inspectInvitation({ code: made.code })).invitationId).toBe(made.invitationId)
    await ctx.identity.signup({ email: 'new@example.com', password: 'password', invitationCode: made.code })
    expect((await ctx.identity.listInvitations({ ownerId: owner.userId }))[0]).toMatchObject({
      invitationId: made.invitationId,
      code: null,
    })
    await expect(ctx.identity.inspectInvitation({ code: made.code })).rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    await expect(ctx.identity.signup({ email: 'again@example.com', password: 'password', invitationCode: made.code })).rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    await expect(ctx.identity.inspectInvitation({ code: 'missing' })).rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    await expect(ctx.identity.signup({ email: 'required@example.com', password: 'password', invitationCode: '' }))
      .rejects.toMatchObject({ code: 'INVITATION_REQUIRED' })
  })

  it('rejects an expired invitation', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const { ctx, owner } = await boot({ invitationTtlSeconds: 1 })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    vi.spyOn(Date, 'now').mockReturnValue(now + 1_001)
    await expect(ctx.identity.inspectInvitation({ code: made.code }))
      .rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    expect((await ctx.identity.listInvitations({ ownerId: owner.userId }))[0]?.code).toBeNull()
  })

  it('keeps active plaintext decryptable across reopen and rotates without consuming another slot', async () => {
    const { ctx, owner, path } = await boot({ invitationPepper: 'persistent-test-pepper' })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    await ctx.fiber.dispose()

    const reopened = new Context()
    await reopened.plugin(LocalIdentityProvider, {
      path,
      bootstrap: { email: 'admin@example.com', password: 'admin-pass' },
      invitationPepper: 'persistent-test-pepper',
    })
    const signed = await reopened.identity.signin({ email: 'admin@example.com', password: 'admin-pass' })
    expect((await reopened.identity.listInvitations({ ownerId: signed.userId }))[0]?.code).toBe(made.code)

    const rotated = await reopened.identity.rotateInvitation({ ownerId: signed.userId, invitationId: made.invitationId })
    expect(rotated.code).not.toBe(made.code)
    expect(await reopened.identity.listInvitations({ ownerId: signed.userId })).toHaveLength(1)
    await expect(reopened.identity.inspectInvitation({ code: made.code }))
      .rejects.toMatchObject({ code: 'INVITATION_INVALID' })
    await expect(reopened.identity.inspectInvitation({ code: rotated.code })).resolves.toEqual({ invitationId: made.invitationId })
    await reopened.fiber.dispose()
  })

  it('fails closed for legacy or undecryptable ciphertext and lets the owner regenerate it', async () => {
    const { ctx, owner, path } = await boot({ invitationPepper: 'original-test-pepper' })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    await ctx.fiber.dispose()

    const db = new DatabaseSync(path)
    db.prepare('UPDATE invitations SET code_ciphertext = NULL WHERE invitation_id = ?').run(made.invitationId)
    db.close()

    const reopened = new Context()
    await reopened.plugin(LocalIdentityProvider, {
      path,
      bootstrap: { email: 'admin@example.com', password: 'admin-pass' },
      invitationPepper: 'original-test-pepper',
    })
    const signed = await reopened.identity.signin({ email: 'admin@example.com', password: 'admin-pass' })
    expect((await reopened.identity.listInvitations({ ownerId: signed.userId }))[0]).toMatchObject({
      invitationId: made.invitationId,
      code: null,
    })
    const rotated = await reopened.identity.rotateInvitation({ ownerId: signed.userId, invitationId: made.invitationId })
    expect((await reopened.identity.listInvitations({ ownerId: signed.userId }))[0]?.code).toBe(rotated.code)
    expect(await reopened.identity.listInvitations({ ownerId: signed.userId })).toHaveLength(1)
    await reopened.fiber.dispose()
  })

  it('does not disclose an active code when the encryption key is unavailable', async () => {
    const { ctx, owner, path } = await boot({ invitationPepper: 'correct-test-pepper' })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    await ctx.fiber.dispose()

    const wrongKey = new Context()
    await wrongKey.plugin(LocalIdentityProvider, {
      path,
      bootstrap: { email: 'admin@example.com', password: 'admin-pass' },
      invitationPepper: 'different-test-pepper',
    })
    const signed = await wrongKey.identity.signin({ email: 'admin@example.com', password: 'admin-pass' })
    expect((await wrongKey.identity.listInvitations({ ownerId: signed.userId }))[0]).toMatchObject({
      invitationId: made.invitationId,
      code: null,
    })
    await wrongKey.fiber.dispose()
  })

  it('enforces three lifetime slots and inherited slots', async () => {
    const { ctx, owner } = await boot()
    const invitations = await Promise.all([1, 2, 3].map(() => ctx.identity.createInvitation({ ownerId: owner.userId })))
    await expect(ctx.identity.createInvitation({ ownerId: owner.userId })).rejects.toMatchObject({ code: 'INVITATION_LIMIT' })
    const firstInvitation = invitations[0]
    if (firstInvitation === undefined) throw new Error('missing first invitation')
    const child = await ctx.identity.signup({
      email: 'child@example.com',
      password: 'password',
      invitationCode: firstInvitation.code,
    })
    const childInvitation = await ctx.identity.createInvitation({ ownerId: child.userId })
    expect(typeof childInvitation.code).toBe('string')
  })

  it('serializes concurrent signups at the population limit', async () => {
    const { ctx, owner } = await boot({ maxUsers: 2 })
    const first = await ctx.identity.createInvitation({ ownerId: owner.userId })
    const second = await ctx.identity.createInvitation({ ownerId: owner.userId })
    const results = await Promise.allSettled([
      ctx.identity.signup({ email: 'first@example.com', password: 'password', invitationCode: first.code }),
      ctx.identity.signup({ email: 'second@example.com', password: 'password', invitationCode: second.code }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'USER_LIMIT' } })
  })

  it('allows only one concurrent redemption of one invitation', async () => {
    const { ctx, owner } = await boot()
    const invitation = await ctx.identity.createInvitation({ ownerId: owner.userId })
    const results = await Promise.allSettled([
      ctx.identity.signup({ email: 'first-redemption@example.com', password: 'password', invitationCode: invitation.code }),
      ctx.identity.signup({ email: 'second-redemption@example.com', password: 'password', invitationCode: invitation.code }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'INVITATION_INVALID' } })
  })

  it('rejects invitation operations at capacity and never stores plaintext', async () => {
    const { ctx, owner, path } = await boot({ maxUsers: 2, invitationPepper: 'secret-pepper' })
    const made = await ctx.identity.createInvitation({ ownerId: owner.userId })
    const storageBytes = await Promise.all((await readdir(dirname(path))).map(name => readFile(join(dirname(path), name))))
    expect(storageBytes.some(bytes => bytes.includes(made.code))).toBe(false)
    expect(storageBytes.some(bytes => bytes.includes('secret-pepper'))).toBe(false)
    await ctx.identity.signup({ email: 'capacity@example.com', password: 'password', invitationCode: made.code })
    await expect(ctx.identity.createInvitation({ ownerId: owner.userId })).rejects.toMatchObject({ code: 'USER_LIMIT' })
    await expect(ctx.identity.inspectInvitation({ code: 'anything' })).rejects.toMatchObject({ code: 'USER_LIMIT' })
  })

  it('creates an owner-only pepper file when omitted', async () => {
    const { ctx, owner, path } = await boot()
    await ctx.identity.createInvitation({ ownerId: owner.userId })
    const info = await stat(`${path}.invitation-pepper`)
    expect(info.mode & 0o777).toBe(0o600)
    expect((await readFile(`${path}.invitation-pepper`, 'utf8')).trim().length).toBeGreaterThanOrEqual(32)
  })
})
