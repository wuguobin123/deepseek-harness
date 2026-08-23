import { describe, expect, it } from 'vitest';
import { checkBrowserUrlAllowed } from '../src/main/browser-url-policy';

describe('browser url safety policy', () => {
  it('blocks the explicitly listed domain and its subdomains', () => {
    expect(checkBrowserUrlAllowed('https://www.hjtcn.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://hjtcn.com/some/page?x=1').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('http://sub.hjtcn.com/').allowed).toBe(false);
  });

  it('does not block domains that merely contain a blocked domain as prefix', () => {
    expect(checkBrowserUrlAllowed('https://hjtcn.com.evil-example.cn/').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://not-hjtcn.com/').allowed).toBe(true);
  });

  it('blocks hostnames containing strong porn / gambling / drug keywords', () => {
    expect(checkBrowserUrlAllowed('https://some-porn-site.example.net/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://online-casino-example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://www.gambling-example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://bocai-example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://dubo-example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://cannabis-shop.example.com/').allowed).toBe(false);
  });

  it('blocks short risky tokens only at whole-label level', () => {
    expect(checkBrowserUrlAllowed('https://sex.example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://xxx.example.com/').allowed).toBe(false);
    expect(checkBrowserUrlAllowed('https://bet.example.com/').allowed).toBe(false);
    // substring look-alikes must stay reachable
    expect(checkBrowserUrlAllowed('https://essex.example.com/').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://alphabet.com/').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://diabetes.example.org/').allowed).toBe(true);
  });

  it('allows ordinary sites', () => {
    expect(checkBrowserUrlAllowed('https://www.baidu.com/').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://mp.weixin.qq.com/s/abc').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://github.com/openai').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('https://xiaowei.119.45.252.25.nip.io/').allowed).toBe(true);
  });

  it('ignores non-http protocols and malformed urls (handled elsewhere)', () => {
    expect(checkBrowserUrlAllowed('file:///etc/passwd').allowed).toBe(true);
    expect(checkBrowserUrlAllowed('not a url').allowed).toBe(true);
  });
});
