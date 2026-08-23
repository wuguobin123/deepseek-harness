// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/features/assistant/AssistantContext', () => ({
  useAssistant: () => ({ openAssistant: vi.fn() })
}));

import { KnowledgePage } from '../src/renderer/features/knowledge/KnowledgePage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  knowledgeBaseId: 'support',
  tenantId: 'tenant-a',
  name: '售后知识库',
  description: '',
  domain: 'support',
  routingKeywords: ['退换货'],
  isDefault: true,
  enabled: true,
  createdBy: 'sup-001',
  createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z'
};

const uploadedDocument = {
  docId: 'return-flow',
  tenantId: 'tenant-a',
  knowledgeBaseId: 'support',
  knowledgeBaseName: '售后知识库',
  domain: 'support',
  title: 'return-exchange-flow.pdf',
  uri: '',
  chunkCount: 3,
  charCount: 778,
  mimeType: 'application/pdf',
  parser: 'PdfParser',
  indexingStatus: 'completed',
  indexingError: '',
  byteSize: 4096,
  createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z'
};

describe('KnowledgePage file import', () => {
  let container: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(async () => {
    const { act } = await import('react');
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    delete (window as unknown as { workbenchApi?: unknown }).workbenchApi;
    vi.restoreAllMocks();
  });

  it('uploads through the native bridge and refreshes the indexed document list', async () => {
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === '/api/knowledge/bases') {
        return { status: 200, body: { knowledgeBases: [base] } };
      }
      if (input.path.startsWith('/api/knowledge/documents')) {
        return { status: 200, body: { documents: [uploadedDocument] } };
      }
      return { status: 200, body: {} };
    });
    const selectAndUploadKnowledgeDocument = vi.fn(async (knowledgeBaseId: string) => ({
      ok: true as const,
      document: { ...uploadedDocument, knowledgeBaseId }
    }));
    (window as unknown as { workbenchApi: unknown }).workbenchApi = {
      request,
      selectAndUploadKnowledgeDocument
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const { act } = await import('react');
    await act(async () => {
      root?.render(<KnowledgePage />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const buttons = [...container.querySelectorAll('button')];
    await act(async () => {
      buttons.find((button) => button.textContent === '导入文档')?.click();
    });
    expect(container.textContent).toContain('选择文件导入');
    expect(container.textContent).not.toContain('从文本文件读取');
    expect(container.querySelector('input[type="file"]')).toBeNull();

    const importButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '选择文件导入'
    );
    await act(async () => {
      importButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(selectAndUploadKnowledgeDocument).toHaveBeenCalledWith('support');
    expect(request.mock.calls.filter(([input]) => input.path.startsWith('/api/knowledge/documents'))).toHaveLength(2);
    expect(container.textContent).toContain('return-exchange-flow.pdf');
    expect(container.textContent).toContain('已建立索引');
  });
});
