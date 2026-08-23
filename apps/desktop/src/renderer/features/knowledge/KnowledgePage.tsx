import React from 'react';
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeRoute
} from '../../../shared/contracts';
import {
  IconBook,
  IconExternal,
  IconFile,
  IconSearch,
  IconSparkles
} from '../../components/icons';
import { workbenchApi } from '../../api';
import { t } from '../../i18n';
import { useAssistant } from '../assistant/AssistantContext';

function documentType(title: string): string {
  if (title.includes('制度') || title.includes('规范')) return '制度';
  if (title.includes('流程')) return '流程';
  return '资料';
}

function safeExternalUri(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function KnowledgePage(): JSX.Element {
  const { openAssistant } = useAssistant();
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = React.useState<KnowledgeDocument[]>([]);
  const [hits, setHits] = React.useState<KnowledgeHit[]>([]);
  const [route, setRoute] = React.useState<KnowledgeRoute | null>(null);
  const [query, setQuery] = React.useState('');
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = React.useState('');
  const [searchScope, setSearchScope] = React.useState('auto');
  const [loading, setLoading] = React.useState(true);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  const [showCreateBase, setShowCreateBase] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [creatingBase, setCreatingBase] = React.useState(false);
  const [draft, setDraft] = React.useState({ title: '', text: '', uri: '' });
  const [baseDraft, setBaseDraft] = React.useState({
    name: '',
    domain: '',
    description: '',
    routingKeywords: ''
  });

  const loadKnowledgeBases = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bases = await workbenchApi.listKnowledgeBases();
      setKnowledgeBases(bases);
      setSelectedKnowledgeBaseId((current) => {
        if (current && bases.some((item) => item.knowledgeBaseId === current)) return current;
        return (
          bases.find((item) => item.isDefault)?.knowledgeBaseId ??
          bases[0]?.knowledgeBaseId ??
          ''
        );
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  const loadDocuments = React.useCallback(async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDocuments(await workbenchApi.listKnowledgeDocuments(knowledgeBaseId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (selectedKnowledgeBaseId) void loadDocuments(selectedKnowledgeBaseId);
  }, [loadDocuments, selectedKnowledgeBaseId]);

  async function search(): Promise<void> {
    const value = query.trim();
    if (!value) {
      setHits([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const result = await workbenchApi.searchKnowledge(value, {
        knowledgeBaseId: searchScope === 'auto' ? undefined : searchScope,
        autoRoute: searchScope === 'auto'
      });
      setHits(result.hits);
      setRoute(result.route);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSearching(false);
    }
  }

  async function importDocument(): Promise<void> {
    if (!draft.title.trim() || !draft.text.trim()) return;
    setImporting(true);
    setError(null);
    try {
      await workbenchApi.createKnowledgeDocument({
        title: draft.title.trim(),
        text: draft.text.trim(),
        uri: draft.uri.trim(),
        knowledgeBaseId: selectedKnowledgeBaseId
      });
      setDraft({ title: '', text: '', uri: '' });
      setShowImport(false);
      await loadDocuments(selectedKnowledgeBaseId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function selectAndImportDocument(): Promise<void> {
    if (!selectedKnowledgeBaseId) return;
    setImporting(true);
    setError(null);
    try {
      const result = await workbenchApi.selectAndUploadKnowledgeDocument(selectedKnowledgeBaseId);
      if (!result.ok) {
        if (!result.cancelled) setError(result.error || '导入失败');
        return;
      }
      setShowImport(false);
      await loadDocuments(selectedKnowledgeBaseId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function createKnowledgeBase(): Promise<void> {
    if (!baseDraft.name.trim() || !baseDraft.domain.trim()) return;
    setCreatingBase(true);
    setError(null);
    try {
      const created = await workbenchApi.createKnowledgeBase({
        name: baseDraft.name.trim(),
        domain: baseDraft.domain.trim(),
        description: baseDraft.description.trim(),
        routingKeywords: baseDraft.routingKeywords
          .split(/[,，\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
      });
      setBaseDraft({ name: '', domain: '', description: '', routingKeywords: '' });
      setShowCreateBase(false);
      await loadKnowledgeBases();
      setSelectedKnowledgeBaseId(created.knowledgeBaseId);
      setSearchScope(created.knowledgeBaseId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingBase(false);
    }
  }

  return (
    <section className="page page--knowledge" data-testid="knowledge-page">
      <header className="page__header">
        <div>
          <h2>{t('knowledge.title')}</h2>
          <p>集中管理企业制度、流程与业务资料，回答会保留引用来源。</p>
        </div>
        <div className="knowledge-header-actions">
          <button type="button" className="btn" onClick={() => setShowCreateBase(true)}>
            新建知识库
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selectedKnowledgeBaseId}
            onClick={() => setShowImport(true)}
          >
            导入文档
          </button>
        </div>
      </header>

      <section className="knowledge-base-bar" aria-label="知识库选择">
        <div>
          <strong>当前知识库</strong>
          <span>文档严格归属于所选领域知识库</span>
        </div>
        <select
          value={selectedKnowledgeBaseId}
          onChange={(event) => {
            setSelectedKnowledgeBaseId(event.target.value);
            setHits([]);
            setRoute(null);
          }}
          data-testid="knowledge-base-select"
        >
          {knowledgeBases.map((base) => (
            <option key={base.knowledgeBaseId} value={base.knowledgeBaseId}>
              {base.name} · {base.domain || 'general'}
            </option>
          ))}
        </select>
      </section>

      <form
        className="knowledge-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="input-with-icon">
          <IconSearch size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索制度、流程和业务资料"
            aria-label="搜索知识库"
            data-testid="knowledge-search"
          />
        </div>
        <button type="submit" className="btn" disabled={searching || !query.trim()}>
          {searching ? '检索中…' : '搜索'}
        </button>
        <select
          value={searchScope}
          onChange={(event) => setSearchScope(event.target.value)}
          aria-label="检索知识库范围"
          data-testid="knowledge-search-scope"
        >
          <option value="auto">自动按领域路由</option>
          {knowledgeBases.map((base) => (
            <option key={base.knowledgeBaseId} value={base.knowledgeBaseId}>
              仅 {base.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!query.trim()}
          onClick={() => openAssistant(query, { page: 'knowledge', label: '知识库' })}
        >
          <IconSparkles size={14} />
          向 AI 提问
        </button>
      </form>

      {showCreateBase ? (
        <form
          className="knowledge-import knowledge-base-create"
          data-testid="knowledge-base-create"
          onSubmit={(event) => {
            event.preventDefault();
            void createKnowledgeBase();
          }}
        >
          <header>
            <strong>新建领域知识库</strong>
            <span>领域和路由关键词用于把问题送到正确的知识库</span>
          </header>
          <label>
            知识库名称
            <input
              value={baseDraft.name}
              onChange={(event) =>
                setBaseDraft((item) => ({ ...item, name: event.target.value }))
              }
              placeholder="例如：人力资源制度"
              required
            />
          </label>
          <label>
            领域标识
            <input
              value={baseDraft.domain}
              onChange={(event) =>
                setBaseDraft((item) => ({ ...item, domain: event.target.value }))
              }
              placeholder="例如：hr"
              required
            />
          </label>
          <label>
            路由关键词
            <input
              value={baseDraft.routingKeywords}
              onChange={(event) =>
                setBaseDraft((item) => ({
                  ...item,
                  routingKeywords: event.target.value
                }))
              }
              placeholder="输入用于自动路由的关键词"
            />
          </label>
          <label>
            描述
            <textarea
              value={baseDraft.description}
              onChange={(event) =>
                setBaseDraft((item) => ({ ...item, description: event.target.value }))
              }
              placeholder="说明该知识库覆盖的业务范围"
            />
          </label>
          <footer>
            <button type="button" className="btn" onClick={() => setShowCreateBase(false)}>
              取消
            </button>
            <button type="submit" className="btn btn--primary" disabled={creatingBase}>
              {creatingBase ? '正在创建…' : '创建知识库'}
            </button>
          </footer>
        </form>
      ) : null}

      {showImport ? (
        <form
          className="knowledge-import"
          onSubmit={(event) => {
            event.preventDefault();
            void importDocument();
          }}
        >
          <header>
            <strong>导入知识文档</strong>
            <span>
              将写入
              「{knowledgeBases.find((item) => item.knowledgeBaseId === selectedKnowledgeBaseId)?.name ?? '当前知识库'}」
            </span>
          </header>
          <label>
            文档名称
            <input
              value={draft.title}
              onChange={(event) => setDraft((item) => ({ ...item, title: event.target.value }))}
              placeholder="例如：员工休假管理制度"
              required
            />
          </label>
          <label>
            原文链接（可选）
            <input
              value={draft.uri}
              onChange={(event) => setDraft((item) => ({ ...item, uri: event.target.value }))}
              placeholder="https://intranet.example.com/policy/leave"
            />
          </label>
          <label>
            文档内容
            <textarea
              value={draft.text}
              onChange={(event) => setDraft((item) => ({ ...item, text: event.target.value }))}
              placeholder="粘贴制度正文…"
              required
            />
          </label>
          <p className="status-line">
            使用“选择文件导入”可导入 PDF、Word、PPT、Excel、Markdown、TXT、HTML、CSV、JSON 与 XML。
          </p>
          <footer>
            <button type="button" className="btn" onClick={() => setShowImport(false)}>取消</button>
            <button
              type="button"
              className="btn"
              disabled={importing}
              onClick={() => void selectAndImportDocument()}
            >
              {importing ? '正在解析并建立索引…' : '选择文件导入'}
            </button>
            <button type="submit" className="btn btn--primary" disabled={importing}>
              {importing ? '正在导入…' : '导入并建立索引'}
            </button>
          </footer>
        </form>
      ) : null}

      {error ? <p className="err" data-testid="knowledge-error">知识库暂不可用：{error}</p> : null}
      {loading ? <p className="status-line"><span className="spinner" />正在加载知识文档…</p> : null}

      {hits.length > 0 ? (
        <section className="knowledge-results">
          <header>
            <div>
              <h3>检索结果</h3>
              {route ? (
                <small data-testid="knowledge-route">
                  {route.mode === 'automatic' ? '自动路由' : '指定范围'}：
                  {route.knowledgeBases.map((item) => item.name).join('、') ||
                    route.knowledgeBaseIds.join('、')}
                </small>
              ) : null}
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHits([])}>返回文档列表</button>
          </header>
          <ol>
            {hits.map((hit) => {
              const externalUri = safeExternalUri(hit.uri);
              return (
              <li key={hit.chunkId}>
                <IconFile size={17} />
                <div>
                  <strong>{hit.title}</strong>
                  <p>{hit.snippet}</p>
                  <small>
                    {hit.knowledgeBaseName} · {hit.domain || 'general'} · 相关度{' '}
                    {(hit.score * 100).toFixed(0)}%
                  </small>
                </div>
                {externalUri ? <a href={externalUri} target="_blank" rel="noreferrer">打开原文 <IconExternal size={12} /></a> : null}
              </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <>
          {!loading && documents.length === 0 && !error ? (
            <div className="empty" data-testid="knowledge-list">
              <IconBook size={30} />
              <p className="empty__title">还没有知识文档</p>
              <p>导入企业制度或流程后，AI 回答会展示对应引用。</p>
            </div>
          ) : null}
          {documents.length > 0 ? (
            <div className="table-wrap" data-testid="knowledge-list">
              <table className="table knowledge-table">
                <thead>
                  <tr><th>文档名称</th><th>解析与索引</th><th>领域</th><th>更新时间</th><th>可见范围</th><th>来源</th></tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.docId}>
                      <td><span className="document-name"><IconFile size={16} /><strong>{document.title}</strong></span></td>
                      <td>
                        <span className={document.indexingStatus === 'completed' ? 'badge' : 'badge badge--warning'}>
                          {document.mimeType.split('/').pop()?.toUpperCase() || 'FILE'} · {document.chunkCount} 段 · {document.indexingStatus === 'completed' ? '已建立索引' : document.indexingStatus}
                        </span>
                        {document.indexingError ? <small className="err">{document.indexingError}</small> : null}
                      </td>
                      <td>
                        <span className="badge">
                          {document.domain || documentType(document.title)}
                        </span>
                      </td>
                      <td>{new Date(document.updatedAt).toLocaleString('zh-CN')}</td>
                      <td>当前租户</td>
                      <td>
                        {document.uri ? (
                          <a href={document.uri} target="_blank" rel="noreferrer">打开原文 <IconExternal size={12} /></a>
                        ) : (
                          <span className="muted">内部文档</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
