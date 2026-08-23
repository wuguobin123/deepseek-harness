/**
 * artifact 预览链接的系统浏览器外跳补签。
 *
 * 背景：`GET /api/artifacts/{id}/preview` 需要 X-Tenant-ID/X-Actor-ID
 * 或一次性 `?token=`。渲染端任何入口（BrowserPanel「系统浏览器打开」、
 * Markdown 答案里的预览链接点击）最终都汇聚到主进程的 openExternalUrl，
 * 因此在这里集中补签一次，而不是让每个调用点各自处理——
 * 此前 BrowserPanel 的正则 `/preview/?$` 匹配不到带 `#fragment` 的链接
 * （如 `.../preview#01`），Markdown 链接点击更是完全没有补签，两条路径
 * 都会以 401（missing X-Tenant-ID or X-Actor-ID header）告终。
 */

export const ARTIFACT_PREVIEW_PATH = /^\/api\/artifacts\/([^/?#]+)\/preview\/?$/;

export type PreviewTokenMinter = (artifactId: string) => Promise<string>;

/**
 * 若 url 是指向本方后端的 artifact preview 链接且尚未携带 token，
 * 调用 mintToken 补签 ``?token=``（fragment 保留在末尾）；否则原样返回。
 * mintToken 失败会抛错，由调用方决定是阻断还是放行。
 */
export async function withArtifactPreviewToken(
  url: string,
  backendOrigins: readonly string[],
  mintToken: PreviewTokenMinter
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const match = ARTIFACT_PREVIEW_PATH.exec(parsed.pathname);
  if (!match) return url;
  if (parsed.searchParams.has('token')) return url;
  // 只对本方后端 origin 补签，避免把认证语义（及 token 申请行为）带到外站。
  if (!backendOrigins.includes(parsed.origin)) return url;
  const token = await mintToken(match[1]);
  // searchParams 的序列化始终位于 hash 之前，fragment（如 #01）不受影响。
  parsed.searchParams.set('token', token);
  return parsed.toString();
}
