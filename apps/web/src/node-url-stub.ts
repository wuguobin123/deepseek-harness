/**
 * Browser stand-in for `node:url`. `pathToFileURL` is unreachable in the
 * configured loader path and fails loud if that assumption changes.
 */

/** Throwing stand-in for node:url's pathToFileURL (never reached in the browser boot). */
export const pathToFileURL = (): never => {
  throw new Error('node:url is not available in the browser')
}
