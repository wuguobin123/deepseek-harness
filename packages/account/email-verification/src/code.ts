/**
 * 6-digit verification code generation + PBKDF2 hashing.
 *
 * Format: `<6 digit code>` plaintext; PBKDF2-HMAC-SHA256 with 200_000 iterations
 * over a fresh 16-byte salt. The plaintext is never persisted — only the hash.
 *
 * Why PBKDF2 (not scrypt): the search space is tiny (10^6 = 20 bits), so a fast
 * memory-hard KDF buys nothing for an attacker who already brute-forces six
 * digits. PBKDF2 at 200_000 is a deliberately cheap cost to keep legitimate
 * `verifyCode` calls well under 50 ms while still making a single wrong guess
 * rate-limited at the application layer.
 *
 * Comparison uses `crypto.timingSafeEqual` over equal-length byte slices.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

/** Number of decimal digits in a verification code. */
export const CODE_LENGTH = 6
/** Regular expression accepting exactly six decimal digits. */
export const CODE_REGEX = /^\d{6}$/
/** Number of random bytes in each verification-code salt. */
export const SALT_BYTES = 16
/** Number of bytes in the derived verification-code hash. */
export const HASH_BYTES = 32
/** PBKDF2 work factor used for verification-code hashes. */
export const PBKDF2_ITERATIONS = 200_000
/** Digest algorithm used by PBKDF2 for verification-code hashes. */
export const PBKDF2_DIGEST = 'sha256'

/** Assert that `email` looks like a single-`@` address; throws on bad input.
 * @param email Candidate email value.
 * @returns Narrows the value to a string accepted by the verifier.
 */
export function assertEmail(email: unknown): asserts email is string {
  if (typeof email !== 'string') {
    throw new TypeError('email must be a string')
  }
  if (email.length === 0 || email.length > 254) {
    throw new TypeError('email length must be 1..254')
  }
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
    throw new TypeError('email must contain exactly one "@" with non-empty halves')
  }
}

/** Assert that `code` is exactly 6 ASCII digits; throws on bad input.
 * @param code Candidate verification code.
 * @returns Narrows the value to a valid code string.
 */
export function assertCode(code: unknown): asserts code is string {
  if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
    throw new TypeError(`code must match ${CODE_REGEX}`)
  }
}

/**
 * Mint a fresh 6-digit code. Rejection sampling on `randomBytes(4)` to remove
 * the modulo bias of `randomBytes(4) % 1_000_000` (the latter would skew 0..15).
 * @returns A fresh zero-padded six-digit verification code.
 */
export function mintCode(): string {
  while (true) {
    // `readUInt32BE` reads the buffer as an unsigned 32-bit big-endian int.
    // A plain `<< 24` would treat the high byte as signed and produce negative
    // numbers roughly half the time, which `padStart` would not catch.
    const n = randomBytes(4).readUInt32BE(0)
    const reduced = n % 1_000_000
    if (n - reduced < 1_000_000 * 256) {
      return reduced.toString().padStart(CODE_LENGTH, '0')
    }
  }
}

/** Salt for one verification-code row. 16 random bytes.
 * @returns A fresh random salt.
 */
export function mintSalt(): Buffer {
  return randomBytes(SALT_BYTES)
}

/** Hash `code` with `salt` under PBKDF2-HMAC-SHA256 / 200_000 iterations.
 * @param code Plaintext verification code.
 * @param salt Random salt for the code row.
 * @returns The derived verification-code digest.
 */
export function hashCode(code: string, salt: Buffer): Buffer {
  return pbkdf2Sync(code, salt, PBKDF2_ITERATIONS, HASH_BYTES, PBKDF2_DIGEST)
}

/** Constant-time compare two PBKDF2 digests of equal length.
 * @param a First digest.
 * @param b Second digest.
 * @returns Whether both digests have equal bytes.
 */
export function codesEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** `now` in milliseconds — exposed for test injection.
 * @returns Current Unix time in milliseconds.
 */
export function nowMillis(): number {
  return Date.now()
}
