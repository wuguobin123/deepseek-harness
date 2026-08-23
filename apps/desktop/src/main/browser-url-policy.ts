/**
 * Embedded-browser URL safety policy.
 *
 * The embedded browser must never open porn / gambling / drug related pages.
 * Enforcement lives in the main process (browser-controller.ts): both the
 * explicit `navigate()` entry point and the `will-navigate` / `will-redirect`
 * guards consult this module, so user address-bar input, agent-driven
 * navigation, in-page link clicks and server redirects are all covered.
 *
 * Detection is hostname based:
 *   1. an explicit blocked-domain list (suffix match, covers subdomains);
 *   2. strong keyword substrings in the hostname (distinctive category terms);
 *   3. short risky tokens matched at whole domain-label level only, to avoid
 *      false positives such as "alphabet" containing "bet".
 *
 * Extra domains can be appended via the WORKBENCH_BROWSER_BLOCKED_DOMAINS
 * environment variable (comma separated).
 */

export interface BrowserUrlPolicyResult {
  allowed: boolean;
  reason: string | null;
}

const BLOCKED_REASON = '该网址已被安全策略拦截：疑似涉及色情、赌博或毒品等违规内容，内嵌浏览器不予打开';

const BLOCKED_DOMAINS: readonly string[] = [
  'hjtcn.com'
];

// Distinctive category terms, safe to match as hostname substrings.
const BLOCKED_HOST_KEYWORDS: readonly string[] = [
  // porn
  'porn',
  'hentai',
  'xvideos',
  'xnxx',
  'xhamster',
  'youporn',
  'redtube',
  'onlyfans',
  'chaturbate',
  'spankbang',
  // gambling
  'casino',
  'gambl',
  'baccarat',
  'sbobet',
  'betway',
  'bet365',
  'betfair',
  '1xbet',
  'dubo',
  'duchang',
  'bocai',
  'caipiao',
  // drugs
  'cannabis',
  'marijuana',
  'cocaine',
  'heroin',
  'fentanyl'
];

// Short risky tokens: matched only when they form a whole hostname label.
const BLOCKED_HOST_LABELS: readonly string[] = [
  'sex',
  'xxx',
  'poker',
  'bet',
  'bets',
  'slot',
  'slots',
  'weed'
];

function extraBlockedDomains(): string[] {
  const raw = process.env.WORKBENCH_BROWSER_BLOCKED_DOMAINS ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function matchesBlockedDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function checkBrowserUrlAllowed(rawUrl: string): BrowserUrlPolicyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: true, reason: null };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: true, reason: null };
  }
  const hostname = url.hostname.toLocaleLowerCase().replace(/\.+$/, '');
  if (!hostname) return { allowed: true, reason: null };

  const domains = [...BLOCKED_DOMAINS, ...extraBlockedDomains()];
  for (const domain of domains) {
    if (matchesBlockedDomain(hostname, domain)) {
      return { allowed: false, reason: `${BLOCKED_REASON}（${domain}）` };
    }
  }
  for (const keyword of BLOCKED_HOST_KEYWORDS) {
    if (hostname.includes(keyword)) {
      return { allowed: false, reason: BLOCKED_REASON };
    }
  }
  for (const label of hostname.split('.')) {
    if (BLOCKED_HOST_LABELS.includes(label)) {
      return { allowed: false, reason: BLOCKED_REASON };
    }
  }
  return { allowed: true, reason: null };
}
