import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  MarkdownContent,
  openMarkdownExternalLink
} from '../src/renderer/features/assistant/MarkdownContent';

describe('MarkdownContent', () => {
  it('renders assistant markdown as semantic HTML', () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>
        {'## 教育建议\n\n1. **树立榜样**：以身作则\n2. 建立有效沟通\n\n> 尊重个体差异'}
      </MarkdownContent>
    );

    expect(markup).toContain('<h2>教育建议</h2>');
    expect(markup).toContain('<ol>');
    expect(markup).toContain('<strong>树立榜样</strong>');
    expect(markup).toContain('<blockquote>');
    expect(markup).not.toContain('**树立榜样**');
  });

  it('does not execute raw HTML or unsafe links', () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>
        {'<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))'}
      </MarkdownContent>
    );

    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('<span>危险链接</span>');
  });

  it('opens safe Markdown links through the Electron external-link bridge', async () => {
    const preventDefault = vi.fn();
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true });

    openMarkdownExternalLink(
      { preventDefault },
      'https://my.feishu.cn/docx/WhC4dMsqgowFpAxEmbccE0Ymnvg',
      openExternalUrl
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(openExternalUrl).toHaveBeenCalledWith(
      'https://my.feishu.cn/docx/WhC4dMsqgowFpAxEmbccE0Ymnvg'
    );
  });
});
