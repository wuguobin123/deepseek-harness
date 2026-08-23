// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsPage } from '../src/renderer/features/integrations/IntegrationsPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Lark CLI connector form', () => {
  let container: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(async () => {
    const { act } = await import('react');
    await act(async () => root?.unmount());
    container?.remove();
    delete (window as unknown as { workbenchApi?: unknown }).workbenchApi;
    vi.restoreAllMocks();
  });

  it('stores app credentials in the current user scoped Lark CLI connector', async () => {
    const request = vi.fn(async (input: { method: string; path: string; body?: Record<string, unknown> }) => {
      if (input.method === 'POST' && input.path === '/api/connectors') {
        return {
          status: 201,
          body: {
            connectorId: 'CONN-LARK-CLI', kind: 'lark', displayName: '我的飞书 CLI',
            baseUrl: 'https://open.feishu.cn', authType: 'api_key', status: 'configured', hasCredentials: true
          }
        };
      }
      if (input.path === '/api/capabilities') return { status: 200, body: { capabilities: [] } };
      if (input.path === '/api/skill-installations') return { status: 200, body: { installations: [] } };
      return { status: 200, body: { connectors: [] } };
    });
    (window as unknown as { workbenchApi: unknown }).workbenchApi = { request };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const { act } = await import('react');
    await act(async () => {
      root?.render(<IntegrationsPage />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await act(async () => {
      (container?.querySelector('[data-testid="connector-add"]') as HTMLButtonElement).click();
    });
    const form = container.querySelector('[data-testid="connector-form"]') as HTMLFormElement;
    const [kind] = [...form.querySelectorAll('select')] as HTMLSelectElement[];
    await act(async () => change(kind, 'lark'));
    expect(form.querySelector('[aria-label="飞书应用 ID"]')).not.toBeNull();
    expect(form.querySelector('[aria-label="飞书应用密钥"]')).not.toBeNull();
    expect([...form.querySelectorAll('label')].some((label) => label.textContent?.includes('认证方式'))).toBe(false);

    const name = form.querySelector('input:not([type])') as HTMLInputElement;
    const baseUrl = form.querySelector('input[type="url"]') as HTMLInputElement;
    const appId = form.querySelector('[aria-label="飞书应用 ID"]') as HTMLInputElement;
    const appSecret = form.querySelector('[aria-label="飞书应用密钥"]') as HTMLInputElement;
    await act(async () => {
      change(name, '我的飞书 CLI');
      change(baseUrl, 'https://open.feishu.cn');
      change(appId, 'cli_test');
      change(appSecret, 'test-secret');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const save = request.mock.calls.find(([input]) => input.method === 'POST')?.[0];
    expect(save?.body).toMatchObject({
      connector_id: 'CONN-LARK-CLI', kind: 'lark', auth_type: 'api_key',
      credentials: { app_id: 'cli_test', app_secret: 'test-secret' }
    });
  });
});
