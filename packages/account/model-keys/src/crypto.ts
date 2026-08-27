/**
 * AES-256-GCM envelope for the on-disk `key_value_encrypted` column.
 *
 * Format: `iv (12 bytes) || tag (16 bytes) || ciphertext` — all three are
 * concatenated into the BLOB; the IV is randomized per write so two rows
 * with the same plaintext differ at rest.
 *
 * The master key is loaded from the bundle's `XIAOWEI_MASTER_KEY` env.
 * Format: 32 raw bytes, urlsafe-base64. The provider fails loud when the
 * env is missing or the decoded length is wrong; we never silently default
 * to a derived-from-config key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ModelKeyError, TAG_BYTES, IV_BYTES } from './errors.ts'

const ALGO = 'aes-256-gcm'
const KEY_BYTES = 32

/** Decode and validate the deployment master key.
 * @param raw URL-safe base64 containing exactly 32 bytes.
 * @returns The decoded AES-256 key.
 */
export function decodeMasterKey(raw: string): Buffer {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ModelKeyError('MASTER_KEY_NOT_CONFIGURED', 'XIAOWEI_MASTER_KEY is not set')
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(raw, 'base64url')
  } catch (cause) {
    throw new ModelKeyError('MASTER_KEY_INVALID', 'XIAOWEI_MASTER_KEY is not valid base64url', cause)
  }
  if (bytes.length !== KEY_BYTES) {
    throw new ModelKeyError(
      'MASTER_KEY_INVALID',
      `XIAOWEI_MASTER_KEY decodes to ${bytes.length} bytes, expected ${KEY_BYTES}`,
    )
  }
  return bytes
}

/** Encrypt one upstream bearer.
 * @param masterKey AES-256 key.
 * @param plaintext Upstream bearer token.
 * @returns The `iv||tag||ciphertext` envelope.
 */
export function encryptValue(masterKey: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext])
}

/** Decrypt one stored bearer.
 * @param masterKey AES-256 key.
 * @param blob Stored `iv||tag||ciphertext` envelope.
 * @returns The original upstream bearer.
 */
export function decryptValue(masterKey: Buffer, blob: Buffer): string {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new ModelKeyError('MASTER_KEY_INVALID', 'ciphertext too short')
  }
  const iv = blob.subarray(0, IV_BYTES)
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, masterKey, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plain.toString('utf8')
}

/** Generate a fresh opaque row identifier.
 * @returns An `mk_`-prefixed identifier.
 */
export function mintKeyId(): string {
  return `mk_${randomBytes(8).toString('hex')}`
}
