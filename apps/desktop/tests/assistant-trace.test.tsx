import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ActivityTrail,
  SourceList
} from '../src/renderer/features/assistant/AssistantPage';

describe('assistant execution trace', () => {
  it('renders a collapsed concise action list', () => {
    const markup = renderToStaticMarkup(
      <ActivityTrail
        streaming={false}
        activities={[
          { id: '0:accepted', phase: 'accepted', message: 'internal', turn: 0 },
          {
            id: '1:reasoning',
            phase: 'reasoning',
            message: 'internal',
            turn: 1
          },
          {
            id: '1:browser',
            phase: 'tool_start',
            message: 'internal',
            turn: 1,
            capabilityId: 'workbench.browser_extract'
          },
          {
            id: '1:result',
            phase: 'tool_result',
            message: 'internal',
            turn: 1,
            capabilityId: 'workbench.browser_extract'
          },
          {
            id: '2:complete',
            phase: 'completion_ready',
            message: 'internal',
            turn: 2
          }
        ]}
      />
    );

    expect(markup).toContain('<details class="assistant-activity">');
    expect(markup).not.toContain('<details class="assistant-activity" open="">');
    expect(markup).toContain('浏览器内容提取');
    expect(markup).toContain('执行查询');
    expect(markup).toContain('核对查询结果');
    expect(markup).not.toContain('思考摘要');
    expect(markup).not.toContain('workbench.browser_extract');
    expect(markup).not.toContain('>internal<');
  });
});

describe('assistant citations', () => {
  it('keeps only deduplicated sources with a traceable URI', () => {
    const markup = renderToStaticMarkup(
      <SourceList
        sources={[
          {
            type: 'tool_result',
            title: '内部工具结果',
            abstract: '不应作为引用展示'
          },
          {
            type: 'knowledge',
            title: '员工出差制度',
            uri: 'kb://policies/travel',
            score: 0.86
          },
          {
            type: 'knowledge',
            title: '重复来源',
            uri: 'kb://policies/travel',
            score: 0.86
          }
        ]}
      />
    );

    expect(markup).toContain('引用和依据（1）');
    expect(markup).toContain('知识库');
    expect(markup).toContain('员工出差制度');
    expect(markup).toContain('匹配度 86%');
    expect(markup).not.toContain('内部工具结果');
    expect(markup).not.toContain('重复来源');
  });
});
