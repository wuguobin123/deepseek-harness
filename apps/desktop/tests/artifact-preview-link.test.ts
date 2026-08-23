import { describe, expect, it, vi } from 'vitest';

import {
  ARTIFACT_PREVIEW_PATH,
  withArtifactPreviewToken
} from '../src/main/artifact-preview-link';

const BACKEND_ORIGINS = [
  'http://xiaowei.119.45.252.25.nip.io',
  'http://119.45.252.25:18080'
];

describe('withArtifactPreviewToken', () => {
  it('为本方后端的 preview 链接补签 token 且保留 fragment', async () => {
    const mint = vi.fn().mockResolvedValue('signed-token');
    const result = await withArtifactPreviewToken(
      'http://119.45.252.25:18080/api/artifacts/ART-EA97CADDD8CB/preview#01',
      BACKEND_ORIGINS,
      mint
    );
    expect(mint).toHaveBeenCalledWith('ART-EA97CADDD8CB');
    const parsed = new URL(result);
    expect(parsed.searchParams.get('token')).toBe('signed-token');
    expect(parsed.hash).toBe('#01');
  });

  it('已有 token 的链接不重复补签', async () => {
    const mint = vi.fn();
    const url =
      'http://xiaowei.119.45.252.25.nip.io/api/artifacts/ART-1/preview?token=abc#02';
    expect(await withArtifactPreviewToken(url, BACKEND_ORIGINS, mint)).toBe(url);
    expect(mint).not.toHaveBeenCalled();
  });

  it('非 preview 路径与外站 origin 原样放行', async () => {
    const mint = vi.fn();
    for (const url of [
      'http://119.45.252.25:18080/health',
      'https://example.com/api/artifacts/ART-1/preview',
      'http://119.45.252.25:18080/api/artifacts/ART-1/download'
    ]) {
      expect(await withArtifactPreviewToken(url, BACKEND_ORIGINS, mint)).toBe(url);
    }
    expect(mint).not.toHaveBeenCalled();
  });

  it('非法 URL 原样返回，mint 抛错向上传播', async () => {
    expect(await withArtifactPreviewToken('not-a-url', BACKEND_ORIGINS, vi.fn())).toBe(
      'not-a-url'
    );
    await expect(
      withArtifactPreviewToken(
        'http://119.45.252.25:18080/api/artifacts/ART-1/preview',
        BACKEND_ORIGINS,
        () => Promise.reject(new Error('network down'))
      )
    ).rejects.toThrow('network down');
  });

  it('路径正则可容忍结尾斜杠并正确提取 artifactId', () => {
    expect(ARTIFACT_PREVIEW_PATH.exec('/api/artifacts/ART-9/preview/')?.[1]).toBe('ART-9');
    expect(ARTIFACT_PREVIEW_PATH.test('/api/artifacts/ART-9/preview/extra')).toBe(false);
  });
});
