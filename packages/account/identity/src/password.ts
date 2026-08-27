/**
 * scrypt password hashing for the local identity provider.
 *
 * Format on disk: `scrypt$N=<nlog2>$r=<r>$p=<p>$<saltBase64Url>$<hashBase64Url>`
 *   - N=16384, r=8, p=1, salt 16 bytes, hash 64 bytes
 *   - Parameters are stored in the wire format so a future migration can
 *     re-verify with stronger cost without rejecting existing rows.
 *
 * Why scrypt (not argon2 / bcrypt): no new dep, stdlib Node `crypto.scrypt`.
 * Why base64url (not hex / base64): wire is JSON, urlsafe alphabet avoids
 * escaping; salts and hashes are 16 / 64 bytes, neither fits hex's per-byte
 * doubling without bloating the row.
 *
 * Comparison uses `crypto.timingSafeEqual` over the recovered-byte slice, not
 * the encoded string: `===` short-circuits on the first byte and leaks a
 * prefix-oracle timing side channel.
 */

/* jscpd:ignore-start -- deliberately mirrors the boot/cordis-config-files
   deterministic-scrypt shape: same N/r/p, same base64url alphabet, same salt
   length, same hash length. Two readers with the same parameters produce
   hashes a future migration can decode, so the wire format is the contract. */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>

/** scrypt N (cost) parameter, log2 = 14, the Node stdlib minimum. */
export const SCRYPT_N = 16384
/** scrypt r (block size). */
export const SCRYPT_R = 8
/** scrypt p (parallelization). */
export const SCRYPT_P = 1
/** Random salt length in bytes. */
export const SALT_BYTES = 16
/** Derived key length in bytes. */
export const HASH_BYTES = 64
/** Algorithm tag in the on-disk format. */
export const ALGORITHM = 'scrypt'

/**
 * The header segment between `scrypt$` and the salt: a single
 * `N=<n>&r=<r>&p=<p>` triple. A future migration can read the three fields,
 * re-run scrypt with stronger parameters, and update the header on rewrite.
 */
const PARAMETER_SEGMENT = `N=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}`

/**
 * Hash one password with a fresh random salt.
 * @param password - The plaintext password.
 * @returns The encoded `scrypt$N=...$r=...$p=...$<salt>$<hash>` string.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password: empty value cannot be hashed')
  }
  const salt = randomBytes(SALT_BYTES)
  const hash = await scrypt(password, salt, HASH_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `${ALGORITHM}$${PARAMETER_SEGMENT}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

/**
 * Compare one plaintext password against an encoded hash.
 * @param encoded - The `scrypt$N=...$...$<salt>$<hash>` string previously produced by {@link hashPassword}.
 * @param password - The candidate plaintext password.
 * @returns true when the password matches; false otherwise. Never throws on a
 *   well-formed but non-matching candidate; throws on a malformed encoded value
 *   because the stored row is supposed to be parseable.
 */
export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new TypeError('verifyPassword: encoded value must be a non-empty string')
  }
  const parts = encoded.split('$')
  // 6 segments: "scrypt" | "N=16384" | "r=8" | "p=1" | "<salt>" | "<hash>".
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    throw new TypeError(`verifyPassword: encoded value must start with "${ALGORITHM}$" and carry six segments`)
  }
  const [nSeg, rSeg, pSeg, saltSeg, hashSeg] = parts.slice(1) as [string, string, string, string, string]
  if (`${nSeg}$${rSeg}$${pSeg}` !== PARAMETER_SEGMENT) {
    throw new TypeError(`verifyPassword: encoded value must carry header "${PARAMETER_SEGMENT}"`)
  }
  if (!nSeg.startsWith('N=') || !rSeg.startsWith('r=') || !pSeg.startsWith('p=')) {
    throw new TypeError('verifyPassword: encoded value parameter segments are malformed')
  }
  const salt = Buffer.from(saltSeg, 'base64url')
  const expected = Buffer.from(hashSeg, 'base64url')
  if (salt.length !== SALT_BYTES) {
    throw new TypeError(`verifyPassword: salt must be ${SALT_BYTES} bytes (got ${salt.length})`)
  }
  if (expected.length !== HASH_BYTES) {
    throw new TypeError(`verifyPassword: hash must be ${HASH_BYTES} bytes (got ${expected.length})`)
  }
  const candidate = await scrypt(password, salt, HASH_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
/* jscpd:ignore-end */
