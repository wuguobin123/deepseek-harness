import { describe, expect, it } from 'vitest'
import { ACCOUNT_RPC_METHODS, assertRoutePartition } from '../src/index.ts'

describe('account RPC route ownership', () => {
  it('keeps account routes disjoint from core and covers the complete registry', () => {
    const core = ['workspace.list', 'workspace.create', 'fs.read']
    expect(() => assertRoutePartition(core, [...core, ...ACCOUNT_RPC_METHODS])).not.toThrow()
  })

  it('rejects overlap and uncovered methods', () => {
    expect(() => assertRoutePartition(['account.signin'], ACCOUNT_RPC_METHODS)).toThrow(/overlaps/)
    expect(() => assertRoutePartition([], ACCOUNT_RPC_METHODS.slice(0, -1))).toThrow(/absent/)
  })
})
