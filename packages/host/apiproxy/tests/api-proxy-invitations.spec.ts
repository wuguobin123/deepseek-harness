import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalIdentityProvider from '@deepseek-ai/dsh-account-identity'
import LocalEmailVerificationProvider from '@deepseek-ai/dsh-account-email-verification'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId, type RpcPrincipal, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
})

async function boot(): Promise<{ ctx: Context; api: ReturnType<typeof createApiProxy>; admin: RpcPrincipal }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-api-invitations-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  await ctx.plugin(LocalIdentityProvider, {
    path: join(root, 'identity.sqlite'),
    bootstrap: { email: 'admin@example.test', password: 'admin-password' },
    invitationPepper: 'api-invitations-test-pepper',
    maxUsers: 100,
    maxInvitationsPerUser: 3,
  })
  await ctx.plugin(LocalEmailVerificationProvider, {
    path: join(root, 'email-verification.sqlite'),
    transportKind: 'logging',
    resendCooldownSeconds: 0,
  })
  const signed = await ctx.identity.signin({ email: 'admin@example.test', password: 'admin-password' })
  return {
    ctx,
    api: createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test' }),
      cwd: root,
    }),
    admin: { kind: 'account', userId: signed.userId },
  }
}

function request<P>(id: string, payload: P, principal?: RpcPrincipal): RpcRequest<P> {
  return { rpcId: RpcId(id), payload, ...(principal === undefined ? {} : { principal }) }
}

describe('account invitation registration API', () => {
  it('requires an account principal and keeps invitation lists owner-scoped', async () => {
    const { api, admin } = await boot()
    const anonymous = await api.account.invites.create(request('anonymous-create', {}))
    expect(anonymous.result).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })

    const created = await api.account.invites.create(request('admin-create', {}, admin))
    expect(created.result.ok).toBe(true)
    if (!created.result.ok) throw new Error(created.result.error.message)
    const listed = await api.account.invites.list(request('admin-list', {}, admin))
    expect(listed.result).toMatchObject({
      ok: true,
      value: { items: [{ invitationId: created.result.value.invitationId, code: created.result.value.code, consumedAt: null }] },
    })

    const anonymousRotate = await api.account.invites.rotate(request('anonymous-rotate', {
      invitationId: created.result.value.invitationId,
    }))
    expect(anonymousRotate.result).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })

    const rotated = await api.account.invites.rotate(request('admin-rotate', {
      invitationId: created.result.value.invitationId,
    }, admin))
    expect(rotated.result.ok).toBe(true)
    if (!rotated.result.ok) throw new Error(rotated.result.error.message)
    expect(rotated.result.value.code).not.toBe(created.result.value.code)
    const afterRotate = await api.account.invites.list(request('admin-list-after-rotate', {}, admin))
    expect(afterRotate.result).toMatchObject({
      ok: true,
      value: { items: [{ invitationId: created.result.value.invitationId, code: rotated.result.value.code }] },
    })
  })

  it('binds the email code to one invitation and gives the invited account three slots', async () => {
    const { api, admin } = await boot()
    const first = await api.account.invites.create(request('first-create', {}, admin))
    const second = await api.account.invites.create(request('second-create', {}, admin))
    if (!first.result.ok || !second.result.ok) throw new Error('failed to create test invitations')

    const emailCode = await api.account.emailCode(request('email-code', {
      email: ' Child@Example.Test ',
      invitationCode: first.result.value.code,
    }))
    expect(emailCode.result.ok).toBe(true)
    if (!emailCode.result.ok) throw new Error(emailCode.result.error.message)
    const verificationCode = (emailCode.result.value as typeof emailCode.result.value & { devCode?: string }).devCode
    expect(verificationCode).toMatch(/^\d{6}$/)
    if (verificationCode === undefined) throw new Error('logging sender did not return a verification code')

    const wrongInvitation = await api.account.signup(request('wrong-invitation', {
      email: 'child@example.test',
      password: 'child-password',
      invitationCode: second.result.value.code,
      verificationCode,
    }))
    expect(wrongInvitation.result).toMatchObject({ ok: false, error: { code: 'bad-request' } })

    const signup = await api.account.signup(request('signup', {
      email: 'child@example.test',
      password: 'child-password',
      invitationCode: first.result.value.code,
      verificationCode,
    }))
    expect(signup.result.ok).toBe(true)
    if (!signup.result.ok) throw new Error(signup.result.error.message)
    const child: RpcPrincipal = { kind: 'account', userId: signup.result.value.userId }

    const crossOwnerRotate = await api.account.invites.rotate(request('child-rotates-admin', {
      invitationId: second.result.value.invitationId,
    }, child))
    expect(crossOwnerRotate.result).toMatchObject({ ok: false, error: { code: 'invitation-invalid' } })

    const childList = await api.account.invites.list(request('child-list', {}, child))
    expect(childList.result).toEqual({ ok: true, value: { items: [] } })
    for (let index = 0; index < 3; index += 1) {
      expect((await api.account.invites.create(request(`child-create-${index}`, {}, child))).result.ok).toBe(true)
    }
    expect((await api.account.invites.create(request('child-create-fourth', {}, child))).result)
      .toMatchObject({ ok: false, error: { code: 'invitation-limit' } })

    const adminList = await api.account.invites.list(request('admin-list-after', {}, admin))
    expect(adminList.result.ok).toBe(true)
    if (!adminList.result.ok) throw new Error(adminList.result.error.message)
    expect(adminList.result.value.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: first.result.value.invitationId,
        redeemedBy: signup.result.value.userId,
      }),
    ]))
  })
})
