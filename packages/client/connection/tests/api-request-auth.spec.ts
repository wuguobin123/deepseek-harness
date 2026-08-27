/**
 * Tests for `packages/client/connection/src/api-request-auth.ts`.
 *
 * Covers the bearer extraction + identity validation primitives the
 * privileged-method fence calls into:
 *   - extractBearerToken trims, accepts only `Bearer <token>`, refuses
 *     other schemes and missing / empty values,
 *   - isAuthenticatedApiRequest resolves a live token via the host's
 *     IdentityService, returns false on missing header / missing service /
 *     rejected token / thrown validate().
 *
 * The fence itself is exercised end-to-end in `node-half.host.spec.ts` over
 * a real HTTP server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingHttpHeaders } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import {
  extractBearerToken,
  isAuthenticatedApiRequest,
  type BearerValidatingService,
} from '../src/api-request-auth.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const NODE_HEADERS: IncomingHttpHeaders = {
  authorization: 'Bearer tkn-1',
}

describe('extractBearerToken', () => {
  it('returns the token for a syntactically valid Bearer header', () => {
    expect(extractBearerToken({ authorization: 'Bearer abc' })).toBe('abc')
  })

  it('trims surrounding whitespace', () => {
    expect(extractBearerToken({ authorization: '   Bearer xyz   ' })).toBe('xyz')
  })

  it('accepts Headers (Web fetch) objects', () => {
    const headers = new Headers({ authorization: 'Bearer web' })
    expect(extractBearerToken(headers)).toBe('web')
  })

  it('returns undefined when the header is missing', () => {
    expect(extractBearerToken({})).toBeUndefined()
  })

  it('returns undefined for a non-Bearer scheme', () => {
    expect(extractBearerToken({ authorization: 'Basic dXNlcjpwYXNz' })).toBeUndefined()
    expect(extractBearerToken({ authorization: 'Token abc' })).toBeUndefined()
  })

  it('returns undefined when the token is empty after the prefix', () => {
    expect(extractBearerToken({ authorization: 'Bearer  ' })).toBeUndefined()
  })

  it('returns undefined for a multi-value header (Node folds to a string)', () => {
    // Node's IncomingMessage.headers uses string | string[] — arrays are an
    // ambiguous shape and we refuse them rather than picking one.
    const headers = { authorization: ['Bearer a', 'Bearer b'] } as unknown as IncomingHttpHeaders
    expect(extractBearerToken(headers)).toBeUndefined()
  })

  it('treats lowercase "bearer" case-insensitively', () => {
    expect(extractBearerToken({ authorization: 'bearer tkn' })).toBe('tkn')
    expect(extractBearerToken({ authorization: 'BEARER tkn' })).toBe('tkn')
  })
})

describe('isAuthenticatedApiRequest', () => {
  function ctxWith(identity: BearerValidatingService | undefined): Context {
    const ctx = new Context()
    if (identity !== undefined) ctx.provide('identity', identity)
    return ctx
  }

  it('returns true when the token resolves to a live session', async () => {
    // NODE_HEADERS carries `Bearer tkn-1`; the validate mock asserts the
    // token reaches the service unchanged, then returns a live identity so
    // the gate resolves to `true`.
    const identity: BearerValidatingService = {
      validate: async ({ sessionToken }) => {
        expect(sessionToken).toBe('tkn-1')
        return { userId: 'u-1', displayName: null }
      },
    }
    const ctx = ctxWith(identity)
    expect(await isAuthenticatedApiRequest({ headers: NODE_HEADERS }, ctx)).toBe(true)
  })

  it('returns false when no Authorization header is present', async () => {
    const validate = vi.fn()
    const ctx = ctxWith({ validate })
    expect(await isAuthenticatedApiRequest({ headers: {} }, ctx)).toBe(false)
    expect(validate).not.toHaveBeenCalled()
  })

  it('returns false when no IdentityService is mounted', async () => {
    const ctx = ctxWith(undefined)
    expect(await isAuthenticatedApiRequest({ headers: NODE_HEADERS }, ctx)).toBe(false)
  })

  it('returns false when validate() resolves null (unknown / expired token)', async () => {
    const ctx = ctxWith({ validate: async () => null })
    expect(await isAuthenticatedApiRequest({ headers: NODE_HEADERS }, ctx)).toBe(false)
  })

  it('returns false when validate() throws (treat as auth failure, do not crash the fence)', async () => {
    const ctx = ctxWith({ validate: async () => { throw new Error('db locked') } })
    expect(await isAuthenticatedApiRequest({ headers: NODE_HEADERS }, ctx)).toBe(false)
  })
})
