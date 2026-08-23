import { describe, expect, it } from 'vitest';
import { parseBrowserIntent } from '../src/renderer/features/browser/browser-intent';
import { supportsBrowserWorkspace } from '../src/renderer/features/browser/BrowserWorkspaceContext';

const OPEN_BROWSER = {
  available: true,
  mode: 'native' as const,
  visible: true,
  url: 'https://mp.weixin.qq.com/s/example',
  title: '已打开的文章',
  isLoading: false,
  canGoBack: true,
  canGoForward: false,
  lastError: null,
  artifactId: null,
  artifactDisplayName: null
};

describe('browser intent planning', () => {
  it('keeps the browser workspace available on both assistant surfaces', () => {
    expect(supportsBrowserWorkspace('/')).toBe(true);
    expect(supportsBrowserWorkspace('/assistant')).toBe(true);
    expect(supportsBrowserWorkspace('/assistant/conversations/123')).toBe(true);
    expect(supportsBrowserWorkspace('/tasks')).toBe(false);
  });

  it('plans search and summarization as explicit browser steps', () => {
    const plan = parseBrowserIntent('打开浏览器，搜索 OpenAI 最新消息并总结');

    expect(plan).not.toBeNull();
    expect(plan?.status).toBe('awaiting_confirmation');
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0].action).toMatchObject({
      type: 'navigate',
      url: expect.stringContaining('bing.com/search')
    });
    expect(plan?.steps[1].action).toEqual({ type: 'extract' });
  });

  it('plans page interactions without accepting unrelated business questions', () => {
    expect(parseBrowserIntent('在浏览器里点击“下一页”')?.steps[0].action).toEqual({
      type: 'click',
      targetText: '下一页'
    });
    expect(parseBrowserIntent('总结今天高意向客户')).toBeNull();
  });

  it('plans direct HTTP navigation and blocks ambiguous open commands', () => {
    expect(parseBrowserIntent('用浏览器打开 https://example.com/docs')?.steps[0].action)
      .toEqual({
        type: 'navigate',
        url: 'https://example.com/docs'
      });
    expect(parseBrowserIntent('打开西湖旗舰店')).toBeNull();
  });

  it('routes a Baidu hot-news request to the news page and extracts it', () => {
    const plan = parseBrowserIntent('打开网页 www.baidu.com，查看今日的热点新闻');

    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0]).toMatchObject({
      label: '打开百度新闻',
      action: { type: 'navigate', url: 'https://news.baidu.com/' }
    });
    expect(plan?.steps[1].action).toEqual({ type: 'extract' });
  });

  it('re-extracts the already open page from a short contextual command', () => {
    const plan = parseBrowserIntent('重新提取', OPEN_BROWSER);

    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0]).toMatchObject({
      label: '读取网页正文并交给助手总结',
      action: { type: 'extract' }
    });
  });

  it('does not hijack short extraction commands without an open page', () => {
    expect(parseBrowserIntent('重新提取')).toBeNull();
    expect(
      parseBrowserIntent('重新提取', { ...OPEN_BROWSER, visible: false })
    ).toBeNull();
    expect(parseBrowserIntent('总结今天高意向客户', OPEN_BROWSER)).toBeNull();
  });
});
