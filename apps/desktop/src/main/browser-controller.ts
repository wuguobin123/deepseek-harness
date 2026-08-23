import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserBounds,
  BrowserState
} from '../shared/contracts';
import { IpcChannels } from '../shared/contracts';
import { checkBrowserUrlAllowed } from './browser-url-policy';
import type { Credentials } from './credential-store';

export const EMBEDDED_BROWSER_PARTITION = 'workbench-browser';

const TRUSTED_DIRECT_IP = '119.45.252.25';
const TRUSTED_DIRECT_NIP_SUFFIX = '.119.45.252.25.nip.io';

function shouldBypassSystemProxy(url: URL): boolean {
  const hostname = url.hostname.toLocaleLowerCase();
  return hostname === TRUSTED_DIRECT_IP ||
    hostname === TRUSTED_DIRECT_NIP_SUFFIX.slice(1) ||
    hostname.endsWith(TRUSTED_DIRECT_NIP_SUFFIX);
}

const EMPTY_STATE: BrowserState = {
  available: true,
  mode: 'native',
  visible: false,
  url: '',
  title: '新标签页',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  lastError: null,
  artifactId: null,
  artifactDisplayName: null
};

const CONTENT_READY_TIMEOUT_MS = 20_000;
const CONTENT_LOADING_EXTENSION_MS = 70_000;
const WECHAT_LOADING_EXTENSION_MS = 200_000;
const CONTENT_POLL_INTERVAL_MS = 400;
const CONTENT_PROBE_TIMEOUT_MS = 2_000;
const ARTICLE_MIN_CHARS = 300;
const GENERAL_PAGE_MIN_CHARS = 500;

function normalizeBrowserUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅允许访问 HTTP 或 HTTPS 网页');
  }
  return url.href;
}

function pageTextActionScript(): string {
  return `(() => {
    const MAX_CHARS = 60000;
    const firstText = (...selectors) => {
      for (const selector of selectors) {
        const value = document.querySelector(selector)?.textContent?.trim();
        if (value) return value;
      }
      return '';
    };
    const title = firstText('#activity-name', 'article h1', 'main h1', 'h1') ||
      document.title || '';
    const author = firstText('#js_name', '.rich_media_meta_nickname', '[rel="author"]');
    const publishedAt = firstText(
      '#publish_time',
      '.rich_media_meta_text',
      'time[datetime]',
      'time'
    );
    const source = document.querySelector(
      '#js_content, .rich_media_content, article, main, [role="main"], ' +
      '.article-content, .article__content, .post-content, .entry-content'
    ) || document.body;
    if (!source) return { title, text: '' };
    const clone = source.cloneNode(true);
    clone.querySelectorAll(
      'script, style, noscript, svg, canvas, form, nav, footer, header, aside, ' +
      'button, input, textarea, select, .qr_code_pc, .rich_media_area_extra, ' +
      '.advertisement, .recommend, .related'
    ).forEach((element) => element.remove());
    clone.querySelectorAll('br').forEach((element) => element.replaceWith('\\n'));

    const clean = (value) => String(value || '')
      .replace(/[\\t\\u00a0]+/g, ' ')
      .replace(/ *\\n */g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
    const rawText = clean(clone.innerText || clone.textContent || '');
    const blocks = [];
    const seen = new Set();
    clone.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre, figcaption, table tr')
      .forEach((element) => {
        const value = clean(element.innerText || element.textContent || '');
        if (value.length < 2 || seen.has(value)) return;
        seen.add(value);
        const tag = element.tagName.toLowerCase();
        if (tag === 'h1') blocks.push('# ' + value);
        else if (tag === 'h2') blocks.push('## ' + value);
        else if (tag === 'h3') blocks.push('### ' + value);
        else if (tag === 'h4') blocks.push('#### ' + value);
        else if (tag === 'li') blocks.push('- ' + value);
        else if (tag === 'blockquote') blocks.push('> ' + value.replace(/\\n/g, '\\n> '));
        else if (tag === 'pre') blocks.push('\`\`\`\\n' + value + '\\n\`\`\`');
        else blocks.push(value);
      });
    const structured = clean(blocks.join('\\n\\n'));
    const body = structured.length >= rawText.length * 0.55 ? structured : rawText;
    const metadata = [
      title ? '# ' + title : '',
      author ? '作者：' + author : '',
      publishedAt ? '发布时间：' + publishedAt : '',
      '页面地址：' + location.href,
      '',
      '## 正文',
      '',
      body
    ].filter((value, index) => value || index >= 4).join('\\n');
    const truncated = metadata.length > MAX_CHARS;
    const text = metadata.slice(0, MAX_CHARS) +
      (truncated ? '\\n\\n> 正文超过 60000 字符，已在安全上限处截断。' : '');
    return {
      title,
      text,
      extractedChars: text.length,
      originalChars: metadata.length,
      truncated
    };
  })()`;
}

interface PageContentProbe {
  readyState: string;
  url: string;
  title: string;
  textChars: number;
  hasArticleRoot: boolean;
  isWechatArticle: boolean;
  accessBlocked: boolean;
}

function pageContentProbeScript(): string {
  return `(() => {
    const isWechatArticle = location.hostname === 'mp.weixin.qq.com';
    const articleRoot = document.querySelector(
      '#js_content, .rich_media_content, article, main, [role="main"], ' +
      '.article-content, .article__content, .post-content, .entry-content'
    );
    const root = articleRoot || document.body;
    const text = String(root?.innerText || root?.textContent || '')
      .replace(/[\\t\\u00a0]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    return {
      readyState: document.readyState,
      url: location.href,
      title: document.title || '',
      textChars: text.length,
      hasArticleRoot: Boolean(articleRoot),
      isWechatArticle,
      accessBlocked: isWechatArticle &&
        !document.querySelector('#js_content, .rich_media_content') &&
        /环境异常|访问过于频繁|请在微信客户端打开|安全验证|操作频繁/.test(text)
    };
  })()`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function installLinkRouterScript(): string {
  return `(() => {
    if (window.__workbenchLinkRouterInstalled) return;
    window.__workbenchLinkRouterInstalled = true;
    const marker = 'data-workbench-route-current';
    const prepareAnchor = (anchor) => {
      if (anchor.getAttribute('target')?.toLocaleLowerCase() !== '_blank') return;
      anchor.setAttribute(marker, 'true');
      anchor.removeAttribute('target');
    };
    const routeInCurrentView = (root) => {
      const anchors = root.querySelectorAll?.('a[target="_blank"]') || [];
      for (const anchor of anchors) prepareAnchor(anchor);
    };
    const routeUrlFromUserGesture = (rawUrl) => {
      if (!navigator.userActivation?.isActive || !rawUrl) return false;
      let url;
      try {
        url = new URL(String(rawUrl), location.href);
      } catch {
        return false;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      location.assign(url.href);
      return true;
    };
    // Sites such as Baidu may call window.open from their own click handlers
    // even after target=_blank has been removed. Preserve user-initiated web
    // navigation in the current view, while automatic/script popups and
    // non-web protocols remain denied by the main-process handler.
    window.open = (url) => {
      routeUrlFromUserGesture(url);
      return null;
    };
    routeInCurrentView(document);
    document.addEventListener('click', (event) => {
      const target = event.target;
      const anchor = target instanceof Element ? target.closest('a[href]') : null;
      if (!anchor) return;
      prepareAnchor(anchor);
      if (anchor.getAttribute(marker) !== 'true') return;
      if (!routeUrlFromUserGesture(anchor.href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          if (record.target.matches('a[target="_blank"]')) prepareAnchor(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('a[target="_blank"]')) prepareAnchor(node);
            routeInCurrentView(node);
          }
        }
      }
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['target'],
      childList: true,
      subtree: true
    });
  })()`;
}

function clickActionScript(targetText: string): string {
  return `(() => {
    const needle = ${JSON.stringify(targetText)}.trim().toLocaleLowerCase();
    const candidates = Array.from(document.querySelectorAll(
      'button, a, [role="button"], input[type="button"], input[type="submit"], summary'
    ));
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const label = (element) => (
      element.innerText ||
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.value ||
      ''
    ).trim().toLocaleLowerCase();
    const target = candidates.find((element) => visible(element) && label(element).includes(needle));
    if (!target) return { ok: false, message: '页面中没有找到“' + ${JSON.stringify(targetText)} + '”' };
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.click();
    return { ok: true, message: '已点击“' + ${JSON.stringify(targetText)} + '”' };
  })()`;
}

function typeActionScript(targetText: string | undefined, value: string, submit: boolean): string {
  return `(() => {
    const needle = ${JSON.stringify(targetText ?? '')}.trim().toLocaleLowerCase();
    const candidates = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'
    ));
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const label = (element) => [
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
      element.id
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    const target = (
      needle
        ? candidates.find((element) => visible(element) && label(element).includes(needle))
        : candidates.find((element) => visible(element))
    );
    if (!target) return { ok: false, message: '页面中没有找到可输入的字段' };
    target.focus();
    if (target.isContentEditable) {
      target.textContent = ${JSON.stringify(value)};
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(target),
        'value'
      )?.set;
      if (setter) setter.call(target, ${JSON.stringify(value)});
      else target.value = ${JSON.stringify(value)};
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (${JSON.stringify(submit)}) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      target.form?.requestSubmit();
    }
    return { ok: true, message: '已输入内容' };
  })()`;
}

export class EmbeddedBrowserController {
  private readonly view: WebContentsView;
  private readonly networkReady: Promise<void>;
  private proxyMode: 'system' | 'direct' = 'system';
  private attached = false;
  private allowWindowOpen = false;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private state: BrowserState = { ...EMPTY_STATE };

  constructor(
    private readonly hostWindow: BrowserWindow,
    private readonly getCredentials: () => Credentials,
    private readonly getBaseUrl: () => string
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        partition: EMBEDDED_BROWSER_PARTITION
      }
    });
    // Some public article platforms return an empty application shell when
    // the User-Agent advertises Electron, even though the embedded engine is
    // a normal Chromium renderer. Keep the real Chromium/platform tokens but
    // remove only the Electron product marker for the isolated browser view.
    const contents = this.view.webContents;
    contents.setUserAgent(
      contents
        .getUserAgent()
        .replace(/\sElectron\/[^\s]+/gi, '')
        .replace(/\s@enterprise-workbench\/desktop\/[^\s]+/gi, '')
    );
    this.networkReady = contents.session.setProxy({ mode: 'system' });
    this.configureSecurity();
    this.bindEvents();
  }

  getState(): BrowserState {
    const contents = this.view.webContents;
    return {
      ...this.state,
      url: contents.getURL() === 'about:blank' ? '' : contents.getURL(),
      title: contents.getTitle() || this.state.title,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward()
    };
  }

  setVisible(visible: boolean): BrowserState {
    if (visible && !this.attached) {
      this.hostWindow.contentView.addChildView(this.view);
      this.view.setBounds(this.bounds);
      this.attached = true;
    } else if (!visible && this.attached) {
      this.hostWindow.contentView.removeChildView(this.view);
      this.attached = false;
    }
    this.state = { ...this.state, visible };
    this.emitState();
    return this.getState();
  }

  setBounds(bounds: BrowserBounds): BrowserState {
    this.bounds = bounds;
    if (this.attached) this.view.setBounds(bounds);
    return this.getState();
  }

  private isLocalArtifactPreview(url: string): { artifactId: string } | null {
    const base = this.getBaseUrl().replace(/\/$/, '');
    if (!base) return null;
    try {
      const parsed = new URL(url);
      const baseParsed = new URL(base);
      // 同源校验：必须是配置的后端地址
      if (parsed.origin !== baseParsed.origin) return null;
      // 路径匹配：/api/artifacts/{artifactId}/preview
      const prefix = baseParsed.pathname.replace(/\/$/, '');
      const relative = parsed.pathname.slice(prefix.length);
      const match = relative.match(/^\/api\/artifacts\/([^/]+)\/preview\/?$/);
      if (!match) return null;
      return { artifactId: match[1] };
    } catch {
      return null;
    }
  }

  private buildAuthHeaders(): Record<string, string> {
    const creds = this.getCredentials();
    const headers: Record<string, string> = {};
    if (creds.apiKey) headers['X-API-Key'] = creds.apiKey;
    if (creds.tenantId) headers['X-Tenant-ID'] = creds.tenantId;
    if (creds.actorId) headers['X-Actor-ID'] = creds.actorId;
    return headers;
  }

  async navigate(rawUrl: string): Promise<BrowserActionResult> {
    try {
      const url = normalizeBrowserUrl(rawUrl);
      const policy = checkBrowserUrlAllowed(url);
      if (!policy.allowed) {
        const message = policy.reason ?? '该网址已被安全策略拦截';
        this.state = { ...this.state, isLoading: false, lastError: message };
        this.emitState();
        return { ok: false, message, state: this.getState() };
      }
      await this.configureNetworkForUrl(url);
      this.setVisible(true);
      // 检测是否为本地后端的 artifact preview 页面；如果是则自动注入鉴权
      // header，避免在地址栏回车 / 刷新时因缺少 X-Tenant-ID 而 401。
      const previewMatch = this.isLocalArtifactPreview(url);
      const extraHeaders = previewMatch ? this.buildAuthHeaders() : {};
      this.state = {
        ...this.state,
        isLoading: true,
        lastError: null,
        artifactId: previewMatch?.artifactId ?? null,
        artifactDisplayName: previewMatch ? `预览 ${previewMatch.artifactId}` : null
      };
      this.emitState();
      const contents = this.view.webContents;
      const loadOptions = Object.keys(extraHeaders).length
        ? { extraHeaders: Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') }
        : undefined;
      void contents.loadURL(url, loadOptions).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/ERR_ABORTED|(-3)/.test(message)) return;
        this.state = { ...this.state, isLoading: false, lastError: message };
        this.emitState();
      });
      return {
        ok: true,
        message: `已开始打开 ${url}，后续步骤将等待正文就绪`,
        state: this.getState()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, isLoading: false, lastError: message };
      this.emitState();
      return { ok: false, message, state: this.getState() };
    }
  }

  async openArtifact(
    rawUrl: string,
    headers: Record<string, string>,
    artifactId: string,
    displayName: string
  ): Promise<BrowserActionResult> {
    try {
      const url = normalizeBrowserUrl(rawUrl);
      await this.configureNetworkForUrl(url);
      this.setVisible(true);
      this.state = {
        ...this.state,
        title: displayName,
        isLoading: true,
        lastError: null,
        artifactId,
        artifactDisplayName: displayName
      };
      this.emitState();
      const extraHeaders = Object.entries(headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      const contents = this.view.webContents;
      void contents.loadURL(url, { extraHeaders }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/ERR_ABORTED|(-3)/.test(message)) return;
        this.state = { ...this.state, isLoading: false, lastError: message };
        this.emitState();
      });
      return {
        ok: true,
        message: `已在右侧浏览器打开 ${displayName}`,
        state: this.getState()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, isLoading: false, lastError: message };
      this.emitState();
      return { ok: false, message, state: this.getState() };
    }
  }

  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    const contents = this.view.webContents;
    try {
      if (action.type === 'navigate') return this.navigate(action.url);
      if (action.type === 'back') {
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        return { ok: true, message: '已返回上一页', state: this.getState() };
      }
      if (action.type === 'forward') {
        if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
        return { ok: true, message: '已前往下一页', state: this.getState() };
      }
      if (action.type === 'reload') {
        // 如果当前页是本地 artifact preview，重新导航以带上鉴权 header
        // （Electron 的 reload() 不会保留 loadURL 时的 extraHeaders）。
        const currentUrl = contents.getURL();
        if (this.isLocalArtifactPreview(currentUrl)) {
          return this.navigate(currentUrl);
        }
        contents.reload();
        return { ok: true, message: '正在刷新页面', state: this.getState() };
      }
      if (action.type === 'stop') {
        contents.stop();
        return { ok: true, message: '已停止加载', state: this.getState() };
      }
      if (action.type === 'scroll') {
        const amount = action.direction === 'down' ? 0.8 : -0.8;
        await contents.executeJavaScript(
          `window.scrollBy({ top: window.innerHeight * ${amount}, behavior: 'smooth' })`
        );
        return {
          ok: true,
          message: action.direction === 'down' ? '已向下滚动' : '已向上滚动',
          state: this.getState()
        };
      }
      if (action.type === 'extract') {
        const readiness = await this.waitForExtractableContent(contents);
        if (!readiness.ready) {
          const location = readiness.probe?.url || contents.getURL();
          const observedChars = readiness.probe?.textChars ?? 0;
          return {
            ok: false,
            message:
              (readiness.probe?.accessBlocked
                ? '页面当前显示的是访问限制或安全验证内容，未执行正文提取。'
                : `页面尚未加载出可提取的正文（当前检测到 ${observedChars} 字符）。`) +
              `请确认页面已经显示完整后重新提取。${location ? ` 页面：${location}` : ''}`,
            state: this.getState()
          };
        }
        const extracted = (await contents.executeJavaScript(pageTextActionScript())) as {
          title?: unknown;
          text?: unknown;
          extractedChars?: unknown;
          originalChars?: unknown;
          truncated?: unknown;
        };
        const text = typeof extracted?.text === 'string' ? extracted.text : '';
        const extractedChars =
          typeof extracted?.extractedChars === 'number' ? extracted.extractedChars : text.length;
        const originalChars =
          typeof extracted?.originalChars === 'number' ? extracted.originalChars : text.length;
        return {
          ok: true,
          message: text
            ? `已读取当前页面正文 ${extractedChars} 字符${
                extracted?.truncated === true ? `（原文约 ${originalChars} 字符，已截断）` : ''
              }`
            : '当前页面没有可读取的正文',
          state: this.getState(),
          extractedText: text
        };
      }
      if (action.type === 'click') {
        this.allowWindowOpen = true;
        let result: { ok?: unknown; message?: unknown };
        try {
          result = (await contents.executeJavaScript(
            clickActionScript(action.targetText),
            true
          )) as { ok?: unknown; message?: unknown };
        } finally {
          this.allowWindowOpen = false;
        }
        return {
          ok: result?.ok === true,
          message: typeof result?.message === 'string' ? result.message : '点击操作未完成',
          state: this.getState()
        };
      }
      const result = (await contents.executeJavaScript(
        typeActionScript(action.targetText, action.value, action.submit === true),
        true
      )) as { ok?: unknown; message?: unknown };
      return {
        ok: result?.ok === true,
        message: typeof result?.message === 'string' ? result.message : '输入操作未完成',
        state: this.getState()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, lastError: message };
      this.emitState();
      return { ok: false, message, state: this.getState() };
    }
  }

  private async waitForExtractableContent(
    contents: WebContents
  ): Promise<{ ready: boolean; probe: PageContentProbe | null }> {
    const softDeadline = Date.now() + CONTENT_READY_TIMEOUT_MS;
    let hardDeadline = softDeadline + CONTENT_LOADING_EXTENSION_MS;
    let previousChars = -1;
    let stableSamples = 0;
    let latest: PageContentProbe | null = null;
    let previousUrl = '';
    let settledEmptySamples = 0;
    let pendingProbe: Promise<PageContentProbe> | null = null;

    while (Date.now() < hardDeadline) {
      if (contents.isDestroyed()) return { ready: false, probe: latest };
      try {
        pendingProbe ??= contents.executeJavaScript(
          pageContentProbeScript()
        ) as Promise<PageContentProbe>;
        const probed = await Promise.race([
          pendingProbe,
          delay(CONTENT_PROBE_TIMEOUT_MS).then(() => null)
        ]);
        if (!probed) {
          stableSamples = 0;
          await delay(CONTENT_POLL_INTERVAL_MS);
          continue;
        }
        pendingProbe = null;
        latest = probed;
        if (latest.isWechatArticle) {
          hardDeadline = Math.max(
            hardDeadline,
            softDeadline + WECHAT_LOADING_EXTENSION_MS
          );
        }
      } catch {
        pendingProbe = null;
        stableSamples = 0;
        await delay(CONTENT_POLL_INTERVAL_MS);
        continue;
      }

      const minimumChars =
        latest.isWechatArticle || latest.hasArticleRoot
          ? ARTICLE_MIN_CHARS
          : GENERAL_PAGE_MIN_CHARS;
      const isDocumentReady = latest.readyState === 'interactive' ||
        latest.readyState === 'complete';
      const delta =
        previousChars < 0 ? Number.POSITIVE_INFINITY : Math.abs(latest.textChars - previousChars);
      const stableTolerance = Math.max(40, Math.round(latest.textChars * 0.03));
      const hasStableBody = delta <= stableTolerance;
      const sameDocument = latest.url === previousUrl;
      const hasCandidateContent = isDocumentReady &&
        !latest.accessBlocked &&
        latest.textChars >= minimumChars;

      stableSamples = hasCandidateContent &&
        hasStableBody &&
        sameDocument
        ? stableSamples + 1
        : 0;
      if (stableSamples >= 2) return { ready: true, probe: latest };
      settledEmptySamples =
        Date.now() >= softDeadline &&
        !contents.isLoading() &&
        !hasCandidateContent &&
        sameDocument
          ? settledEmptySamples + 1
          : 0;
      if (settledEmptySamples >= 3) {
        return { ready: false, probe: latest };
      }

      previousChars = latest.textChars;
      previousUrl = latest.url;
      await delay(CONTENT_POLL_INTERVAL_MS);
    }

    return { ready: false, probe: latest };
  }

  dispose(): void {
    if (this.attached && !this.hostWindow.isDestroyed()) {
      this.hostWindow.contentView.removeChildView(this.view);
    }
    this.attached = false;
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private configureSecurity(): void {
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      // Physical anchor clicks are rewritten to current-view navigation by
      // installLinkRouterScript. A remaining window.open is therefore denied
      // unless it came from the explicit agent click action below.
      if (!this.allowWindowOpen) return { action: 'deny' };
      this.allowWindowOpen = false;
      try {
        const safeUrl = normalizeBrowserUrl(url);
        setImmediate(() => {
          void this.navigate(safeUrl);
        });
      } catch {
        // Unsupported protocols stay blocked.
      }
      return { action: 'deny' };
    });
    const guardNavigation = (event: Electron.Event, rawUrl: string) => {
      try {
        const url = normalizeBrowserUrl(rawUrl);
        const policy = checkBrowserUrlAllowed(url);
        if (!policy.allowed) {
          event.preventDefault();
          contents.stop();
          this.state = {
            ...this.state,
            isLoading: false,
            lastError: policy.reason ?? '该网址已被安全策略拦截'
          };
          this.emitState();
          return;
        }
        const requestedMode = shouldBypassSystemProxy(new URL(url)) ? 'direct' : 'system';
        if (requestedMode !== this.proxyMode) {
          event.preventDefault();
          void this.navigate(url);
        }
      } catch {
        event.preventDefault();
      }
    };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    contents.session.on('will-download', (event) => {
      event.preventDefault();
    });
  }

  private async configureNetworkForUrl(rawUrl: string): Promise<void> {
    await this.networkReady;
    const requestedMode = shouldBypassSystemProxy(new URL(rawUrl)) ? 'direct' : 'system';
    if (requestedMode === this.proxyMode) return;
    await this.view.webContents.session.setProxy({ mode: requestedMode });
    await this.view.webContents.session.closeAllConnections();
    this.proxyMode = requestedMode;
  }

  private bindEvents(): void {
    const contents = this.view.webContents;
    const installLinkRouter = () => {
      void contents.executeJavaScript(installLinkRouterScript()).catch(() => {
        // A navigation can replace the document before the script finishes.
      });
    };
    // Some sites replace or redirect the main document after the first
    // dom-ready. Install again once the final main frame finishes loading;
    // the injected guard is idempotent within each document.
    contents.on('dom-ready', installLinkRouter);
    contents.on('did-finish-load', installLinkRouter);
    contents.on('did-start-loading', () => {
      this.state = { ...this.state, isLoading: true, lastError: null };
      this.emitState();
    });
    contents.on('did-stop-loading', () => {
      this.state = { ...this.state, isLoading: false };
      this.emitState();
    });
    contents.on('did-navigate', () => this.emitState());
    contents.on('did-navigate-in-page', () => this.emitState());
    contents.on('page-title-updated', (_event, title) => {
      this.state = { ...this.state, title };
      this.emitState();
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return;
      this.state = {
        ...this.state,
        isLoading: false,
        lastError: errorDescription || `页面加载失败（${errorCode}）`
      };
      this.emitState();
    });
  }

  private emitState(): void {
    if (this.hostWindow.isDestroyed() || this.hostWindow.webContents.isDestroyed()) return;
    this.hostWindow.webContents.send(IpcChannels.BrowserStateEvent, this.getState());
  }
}
