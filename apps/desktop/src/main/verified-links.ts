/**
 * Verified link opener.
 *
 * Renderer asks main "open artifact X". Main re-validates with the backend via
 * POST /api/verification-artifacts/{id}/open. Only after the backend returns
 * the one-time authorized URL and we audit the open do we call
 * `shell.openExternal`. Renderer cannot smuggle an arbitrary URL into
 * `shell.openExternal` directly — the only input it controls is the artifact
 * ID.
 */
import { shell } from 'electron';
import { URL } from 'node:url';
import { VerificationOpenResultSchema } from '../shared/contracts';
import { ApiClient, ApiClientError } from './api-client';

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export class VerifiedLinkOpener {
  constructor(
    private readonly api: ApiClient,
    private readonly allowedHosts: ReadonlySet<string> = new Set()
  ) {}

  async openArtifact(artifactId: string): Promise<{ url: string; expiresAt: string }> {
    if (!artifactId || artifactId.length > 256) {
      throw new VerifiedLinkError('INVALID_ARTIFACT_ID', 'artifact id is required', 400, undefined);
    }

    const res = await this.api.request<unknown>({
      method: 'POST',
      path: `/api/verification-artifacts/${encodeURIComponent(artifactId)}/open`
    });

    if (res.status >= 400) {
      throw new VerifiedLinkError(
        'AUTHORIZE_FAILED',
        'backend refused to authorize artifact',
        res.status,
        undefined
      );
    }

    const parsed = VerificationOpenResultSchema.safeParse(res.body);
    if (!parsed.success) {
      throw new VerifiedLinkError(
        'INVALID_RESPONSE',
        'backend returned an invalid authorize-open response',
        500,
        undefined
      );
    }

    const safe = this.assertUrlSafe(parsed.data.url);
    if (!safe) {
      throw new VerifiedLinkError('HOST_NOT_ALLOWED', 'host is not in allowlist', 403, undefined);
    }

    await shell.openExternal(parsed.data.url);
    return { url: parsed.data.url, expiresAt: parsed.data.expiresAt };
  }

  private assertUrlSafe(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return false;
    if (url.protocol === 'https:' && url.username || url.password) return false;
    if (this.allowedHosts.size > 0 && !this.allowedHosts.has(url.hostname)) {
      // Allow loopback even if not explicitly configured (dev convenience)
      if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
    }
    return true;
  }
}

export class VerifiedLinkError extends ApiClientError {}