import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword, SCRYPT_N, SCRYPT_R, SCRYPT_P } from '../src/password.ts'

describe('hashPassword', () => {
  it('produces the documented wire format', async () => {
    const hash = await hashPassword('hunter2')
    expect(hash.startsWith(`scrypt$N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$`)).toBe(true)
    // 6 segments: 'scrypt' | `N=${N}` | `r=${R}` | `p=${P}` | salt | hash
    expect(hash.split('$')).toHaveLength(6)
  })

  it('rejects an empty password', async () => {
    await expect(hashPassword('')).rejects.toBeInstanceOf(TypeError)
  })
})

describe('verifyPassword', () => {
  it('accepts the password used to produce the hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
  })

  it('rejects a different password', async () => {
    const hash = await hashPassword('hunter2')
    await expect(verifyPassword(hash, 'hunter3')).resolves.toBe(false)
  })

  it('rejects a malformed encoded value', async () => {
    await expect(verifyPassword('not-an-encoded-hash', 'anything'))
      .rejects.toBeInstanceOf(TypeError)
    await expect(verifyPassword('plaintext$wrong$format', 'anything'))
      .rejects.toBeInstanceOf(TypeError)
  })

  it('rejects an empty encoded value', async () => {
    await expect(verifyPassword('', 'anything')).rejects.toBeInstanceOf(TypeError)
  })
})
