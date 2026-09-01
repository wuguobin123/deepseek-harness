import { describe, expect, it } from 'vitest'
import { name, inject } from '../src/invariant.ts'

describe('business skills invariant companion', () => {
  it('declares its package ownership', () => { expect(name).toBe('client-ui-settings-business-skills-invariant'); expect(inject).toEqual(['invariants']) })
})
