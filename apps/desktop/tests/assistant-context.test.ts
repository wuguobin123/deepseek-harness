import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../src/shared/contracts';
import {
  isBrowserPreviewArtifact,
  persistedMessage,
  type AssistantMessage
} from '../src/renderer/features/assistant/AssistantContext';
import {
  artifactPreviewStrategy,
  type GeneratedArtifact
} from '../src/renderer/features/document-preview/DocumentPreviewContext';

function makeMessage(
  overrides: Partial<ConversationMessage> & {
    blocks: ConversationMessage['content']['blocks'];
  }
): ConversationMessage {
  const { blocks, ...rest } = overrides;
  return {
    messageId: 'MSG-1',
    conversationId: 'CNV-1',
    sequenceNo: 1,
    role: 'assistant',
    status: 'completed',
    content: { schemaVersion: 1, blocks },
    metadata: {},
    ...rest
  };
}

function answerOf(message: AssistantMessage | null) {
  if (!message || message.kind !== 'answer') {
    throw new Error('expected an answer message');
  }
  return message.result;
}

describe('persistedMessage', () => {
  it('keeps artifact_ref blocks with metadata from the conversation artifact index', () => {
    const indexed: GeneratedArtifact = {
      artifactId: 'ART-1',
      displayName: '季度报告.pptx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 2048,
      artifactType: 'generated_file'
    };
    const index = new Map([[indexed.artifactId, indexed]]);
    const restored = persistedMessage(
      makeMessage({
        blocks: [
          { type: 'text', text: '文件已生成' },
          { type: 'artifact_ref', artifactId: 'ART-1' }
        ]
      }),
      index
    );

    const result = answerOf(restored);
    expect(result.answer).toBe('文件已生成');
    expect(result.artifacts).toEqual([indexed]);
  });

  it('prefers block extras displayName/mimeType when the artifact is not in the index', () => {
    const restored = persistedMessage(
      makeMessage({
        blocks: [
          { type: 'text', text: '文件已生成' },
          {
            type: 'artifact_ref',
            artifactId: 'ART-2',
            extras: { displayName: '总结.docx', mimeType: 'application/msword' }
          }
        ]
      }),
      new Map()
    );

    expect(answerOf(restored).artifacts).toEqual([
      {
        artifactId: 'ART-2',
        displayName: '总结.docx',
        mimeType: 'application/msword',
        artifactType: 'generated_file'
      }
    ]);
  });

  it('falls back to displayName=artifactId when neither index nor extras have metadata', () => {
    const restored = persistedMessage(
      makeMessage({
        blocks: [
          { type: 'text', text: '文件已生成' },
          { type: 'artifact_ref', artifactId: 'ART-3' }
        ]
      })
    );

    expect(answerOf(restored).artifacts).toEqual([
      {
        artifactId: 'ART-3',
        displayName: 'ART-3',
        mimeType: null,
        artifactType: 'generated_file'
      }
    ]);
  });

  it('omits artifacts when the message has no artifact_ref blocks', () => {
    const restored = persistedMessage(
      makeMessage({ blocks: [{ type: 'text', text: '纯文本回答' }] })
    );

    expect(answerOf(restored).artifacts).toBeUndefined();
  });

  it('keeps user messages as plain text', () => {
    const restored = persistedMessage(
      makeMessage({
        role: 'user',
        blocks: [
          { type: 'text', text: '帮我生成一个 PPT' },
          { type: 'artifact_ref', artifactId: 'ART-9' }
        ]
      })
    );

    expect(restored).toEqual({
      id: 'MSG-1',
      role: 'user',
      kind: 'text',
      content: '帮我生成一个 PPT'
    });
  });
});

describe('isBrowserPreviewArtifact', () => {
  it('routes generated HTML slides to the right-side browser', () => {
    expect(
      isBrowserPreviewArtifact({
        artifactId: 'ART-HTML',
        displayName: 'launch-deck.html',
        mimeType: 'text/html'
      })
    ).toBe(true);
  });

  it('keeps Office artifacts in the document preview panel', () => {
    expect(
      isBrowserPreviewArtifact({
        artifactId: 'ART-PPTX',
        displayName: 'launch-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      })
    ).toBe(false);
  });
});

describe('artifactPreviewStrategy', () => {
  it.each([
    ['README.md', null, 'markdown'],
    ['README.markdown', 'text/plain', 'markdown'],
    ['report.pdf', null, 'pdf'],
    ['forecast.xlsx', null, 'office'],
    ['brief.docx', null, 'office'],
    ['slides.pptx', null, 'office'],
    ['dashboard.html', null, 'html'],
    ['chart.png', null, 'image'],
    ['photo.jpg', 'image/jpeg', 'image'],
    ['diagram.svg', 'image/svg+xml', 'image'],
    ['notes.txt', 'text/plain', 'fallback']
  ])('routes %s through the %s preview capability', (displayName, mimeType, expected) => {
    expect(
      artifactPreviewStrategy({
        artifactId: 'ART-ROUTING',
        displayName,
        mimeType
      })
    ).toBe(expected);
  });
});
