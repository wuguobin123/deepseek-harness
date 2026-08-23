import type { BrowserAction, BrowserState } from '../../../shared/contracts';

export type BrowserCommandStatus =
  | 'awaiting_confirmation'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface BrowserPlanStep {
  stepId: string;
  label: string;
  action: BrowserAction;
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export interface BrowserOperationPlan {
  planId: string;
  originalMessage: string;
  summary: string;
  status: BrowserCommandStatus;
  steps: BrowserPlanStep[];
  result?: string;
  error?: string;
}

function planId(): string {
  return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanTarget(value: string): string {
  return value
    .trim()
    .replace(/^[“"'「『]/, '')
    .replace(/[”"'」』，。；;]$/, '')
    .trim();
}

function searchQuery(message: string): string | null {
  const match = message.match(
    /(?:搜索|查找)(?:一下)?\s*([^，。；;]+?)(?=(?:并|然后|，|。|；|;|$))/
  );
  return match?.[1] ? cleanTarget(match[1]) : null;
}

function explicitUrl(message: string): string | null {
  const absolute = message.match(/https?:\/\/[^\s，。；;]+/i)?.[0];
  if (absolute) return cleanTarget(absolute);
  const domain = message.match(
    /(?:打开|访问|进入)\s*(?:(?:浏览器|网页|网站|网址)\s*)?((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s，。；;]*)?)/i
  )?.[1];
  return domain ? `https://${cleanTarget(domain)}` : null;
}

function contentDestination(message: string, url: string | null): string | null {
  const wantsBaiduNews =
    /(?:百度.*新闻|新闻.*百度|今日(?:的)?(?:热点)?新闻|热点新闻)/.test(message);
  if (!wantsBaiduNews) return url;
  if (!url || /(?:^|\.)baidu\.com$/i.test(new URL(url).hostname)) {
    return 'https://news.baidu.com/';
  }
  return url;
}

function shouldExtractPage(message: string): boolean {
  return (
    /总结|摘要|提取|读取/.test(message) ||
    /(?:查看|浏览).*(?:新闻|资讯|热点|内容|页面)/.test(message) ||
    /(?:新闻|资讯|热点).*(?:查看|浏览)/.test(message)
  );
}

function isCurrentPageExtraction(message: string, browserState?: BrowserState): boolean {
  if (!browserState?.visible || !browserState.url) return false;
  return /^(?:请)?(?:帮我)?(?:重新|再次|再|继续)?(?:提取|读取|总结|摘要)(?:一下)?(?:当前|这个|本)?(?:网页|页面|正文|内容|文章)?(?:的)?(?:正文|内容|文章)?(?:并(?:进行)?(?:详细)?总结)?[。！!？?]*$/.test(
    message
  );
}

function currentPageAction(message: string): BrowserAction | null {
  const click = message.match(/点击\s*[“"'「『]?([^”"'」』，。；;]+)[”"'」』]?/);
  if (click?.[1]) {
    return { type: 'click', targetText: cleanTarget(click[1]) };
  }
  const typeMatch = message.match(
    /(?:在\s*)?[“"'「『]?([^”"'」』，。；;]*?)[”"'」』]?(?:中|里)?\s*输入\s*[“"'「『]?([^”"'」』，。；;]+)[”"'」』]?/
  );
  if (typeMatch?.[2]) {
    return {
      type: 'type',
      targetText: cleanTarget(typeMatch[1] ?? '') || undefined,
      value: cleanTarget(typeMatch[2]),
      submit: /(?:回车|提交|搜索)/.test(message)
    };
  }
  if (/(?:浏览器)?后退|返回上一页/.test(message)) return { type: 'back' };
  if (/(?:浏览器)?前进|下一页/.test(message)) return { type: 'forward' };
  if (/(?:刷新|重新加载)(?:当前)?(?:网页|页面|浏览器)?/.test(message)) {
    return { type: 'reload' };
  }
  if (/(?:向下|往下)滚动|下翻/.test(message)) {
    return { type: 'scroll', direction: 'down' };
  }
  if (/(?:向上|往上)滚动|上翻/.test(message)) {
    return { type: 'scroll', direction: 'up' };
  }
  return null;
}

export function parseBrowserIntent(
  rawMessage: string,
  browserState?: BrowserState
): BrowserOperationPlan | null {
  const message = rawMessage.trim();
  if (!message) return null;
  const extractsCurrentPage = isCurrentPageExtraction(message, browserState);
  const hasBrowserContext =
    /浏览器|网页|网站|网址|当前页面|百度新闻/.test(message) ||
    /^https?:\/\//i.test(message) ||
    explicitUrl(message) !== null ||
    extractsCurrentPage;
  if (!hasBrowserContext) return null;

  const steps: BrowserPlanStep[] = [];
  const query = searchQuery(message);
  const url = contentDestination(message, explicitUrl(message));
  const action = currentPageAction(message);

  if (query) {
    steps.push({
      stepId: 'navigate-search',
      label: `搜索“${query}”`,
      action: {
        type: 'navigate',
        url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`
      }
    });
  } else if (url) {
    steps.push({
      stepId: 'navigate-url',
      label: url === 'https://news.baidu.com/' ? '打开百度新闻' : `打开 ${url}`,
      action: { type: 'navigate', url }
    });
  } else if (action) {
    steps.push({
      stepId: `browser-${action.type}`,
      label:
        action.type === 'click'
          ? `点击“${action.targetText}”`
          : action.type === 'type'
            ? '在页面中输入内容'
            : action.type === 'scroll'
              ? action.direction === 'down'
                ? '向下滚动页面'
                : '向上滚动页面'
              : action.type === 'back'
                ? '返回上一页'
                : action.type === 'forward'
                  ? '前往下一页'
                  : '刷新当前页面',
      action
    });
  } else if (/打开浏览器|开启浏览器|显示浏览器/.test(message)) {
    steps.push({
      stepId: 'open-browser',
      label: '打开浏览器工作区',
      action: {
        type: 'navigate',
        url: browserState?.url || 'https://www.bing.com/'
      }
    });
  }

  if (shouldExtractPage(message) || extractsCurrentPage) {
    steps.push({
      stepId: 'extract-page',
      label: '读取网页正文并交给助手总结',
      action: { type: 'extract' }
    });
  }
  if (steps.length === 0) return null;

  return {
    planId: planId(),
    originalMessage: message,
    summary:
      steps.length === 1
        ? `我将通过右侧浏览器执行：${steps[0].label}`
        : `我将通过右侧浏览器完成 ${steps.length} 个步骤，并把结果带回对话。`,
    status: 'awaiting_confirmation',
    steps: steps.map((step) => ({ ...step, status: 'pending' }))
  };
}
