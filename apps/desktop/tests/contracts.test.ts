/**
 * Contracts smoke test.
 *
 * The dsh RPC envelope and stream frame unions are re-derived in
 * `src/shared/contracts.ts` so the desktop client does not import the
 * apiproxy package directly. These tests prove the schemas parse the
 * shapes the renderer and preload actually emit; breaking them is the
 * first signal that the wire format drifted.
 */
import { describe, expect, it } from 'vitest'
import {
  ClientRequestSchema,
  ArtifactActionInputSchema,
  ClientResponseSchema,
  HostFrameSchema,
  MuxFrameSchema,
  ServerRequestSchema,
  ServerResponseSchema,
  SessionStateSchema,
  RequestEmailCodeInputSchema,
  SignUpInputSchema,
} from '../src/shared/contracts'

describe('RPC envelope', () => {
  it('parses an outbound client-request', () => {
    const parsed = ClientRequestSchema.parse({
      type: 'client-request',
      rpcId: 'r1',
      method: 'host.describe',
      payload: {},
    })
    expect(parsed.method).toBe('host.describe')
  })

  it('parses an inbound server-response with a success value', () => {
    const parsed = ServerResponseSchema.parse({
      type: 'server-response',
      rpcId: 'r1',
      result: { ok: true, value: { name: 'dsh-ops' } },
    })
    expect(parsed.result).toMatchObject({ ok: true })
  })

  it('parses a client-response to an answerable server-request', () => {
    const parsed = ClientResponseSchema.parse({
      type: 'client-response',
      rpcId: 'r1',
      result: { ok: true, value: { outcome: 'allowed-once' } },
    })
    expect(parsed.result).toMatchObject({ ok: true })
  })

  it('parses an inbound server-request envelope (approval/requested)', () => {
    const parsed = ServerRequestSchema.parse({
      type: 'server-request',
      rpcId: 'r1',
      method: 'approval.respond',
      payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash' },
    })
    expect(parsed.method).toBe('approval.respond')
  })
})

describe('MuxFrame', () => {
  it('preserves a tool result view on session/event', () => {
    const view = {
      for: 'result',
      view: {
        card: 'doc',
        artifactId: 'sha256:artifact',
        bytes: 123,
        mediaType: 'text/markdown',
      },
    }
    const parsed = MuxFrameSchema.parse({
      type: 'session/event',
      sessionId: 's1',
      event: { type: 'tool/result', seq: 2, time: 3, data: {} },
      view,
    })

    expect(parsed).toMatchObject({ type: 'session/event', view })
  })

  it('parses session/jobs', () => {
    const parsed = MuxFrameSchema.parse({
      type: 'session/jobs',
      sessionId: 's1',
      jobs: [
        {
          id: 'j1',
          kind: 'bash',
          label: 'echo hi',
          status: 'running',
          startedAt: 1,
        },
      ],
    })
    expect(parsed.type).toBe('session/jobs')
  })

  it('parses approval/requested', () => {
    const parsed = MuxFrameSchema.parse({
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'bash',
      reason: 'shell access',
    })
    expect(parsed.type).toBe('approval/requested')
  })

  it('parses stream/error', () => {
    const parsed = MuxFrameSchema.parse({
      type: 'stream/error',
      error: { code: 'INTERNAL', message: 'boom' },
    })
    expect(parsed.type).toBe('stream/error')
  })
})

describe('HostFrame', () => {
  it('parses host/session-added', () => {
    const parsed = HostFrameSchema.parse({
      type: 'host/session-added',
      sessionId: 's1',
      blank: true,
    })
    expect(parsed.type).toBe('host/session-added')
  })
})

describe('SessionStateSchema', () => {
  it('defaults the federated preference to cloud without selecting a global Host', () => {
    const parsed = SessionStateSchema.parse({ baseUrl: 'http://127.0.0.1:18000' })
    expect(parsed).toMatchObject({ version: '3', lastLocation: 'cloud' })
    expect(parsed.environment).toBeUndefined()
  })
})

describe('invitation registration contracts', () => {
  it('requires the same invitation field for email-code and signup requests', () => {
    expect(RequestEmailCodeInputSchema.safeParse({ email: 'user@example.com' }).success).toBe(false)
    expect(SignUpInputSchema.safeParse({ email: 'user@example.com', password: 'password' }).success).toBe(false)
    expect(RequestEmailCodeInputSchema.safeParse({
      email: 'user@example.com',
      invitationCode: 'invitation-code',
    }).success).toBe(true)
    expect(SignUpInputSchema.safeParse({
      email: 'user@example.com',
      password: 'password',
      invitationCode: 'invitation-code',
    }).success).toBe(true)
  })
})

describe('ArtifactActionInputSchema', () => {
  it('accepts only content-addressed artifact ids', () => {
    expect(ArtifactActionInputSchema.safeParse({
      artifactId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }).success).toBe(true)
    expect(ArtifactActionInputSchema.safeParse({ artifactId: '../../secret' }).success).toBe(false)
  })
})
