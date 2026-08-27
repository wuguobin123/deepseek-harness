/**
 * Boot-time directory-flow surface resolution for the desktop shell.
 *
 * Mirrors the host's `directory-picker-auto` first rule (a loopback-only
 * bind means the operator sits at the host display): when the configured
 * baseUrl is loopback the dsh host IS this machine, so the native surface
 * (`host.pickDirectory` → osascript/Win32 dialog) opens on the operator's
 * own screen. Any remote baseUrl resolves to the import surface: Electron
 * opens its local OS picker and sends a bounded directory copy to the
 * authenticated account workspace.
 *
 * The choice is sampled once per renderer boot; a baseUrl switch in
 * Settings applies to the picker on the next window reload.
 */

/** Directory-flow surface kind, named after the seam's capability kinds. */
export type DirectoryFlowSurface = 'native' | 'import'

/**
 * Whether a WHATWG URL hostname names the local loopback authority.
 * Semantics align with the connection package's internal
 * `loopback-hostname.ts` predicate (package-internal there, so the
 * desktop keeps its own copy): localhost, IPv6 loopback, any 127/8 IPv4.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true when the hostname is loopback.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Resolve which directory-flow surface this boot activates.
 * @param baseUrl - the configured dsh host base URL (SessionState.baseUrl).
 * @returns 'native' for a loopback host, 'import' otherwise; an
 *   unparseable baseUrl fails to the import surface.
 */
export function resolveDirectoryFlowSurface(baseUrl: string): DirectoryFlowSurface {
  try {
    return isLoopbackHostname(new URL(baseUrl).hostname) ? 'native' : 'import'
  } catch {
    return 'import'
  }
}
