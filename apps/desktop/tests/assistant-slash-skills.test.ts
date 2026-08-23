import { describe, expect, it } from 'vitest';
import {
  replaceSlashSkill,
  slashQuery
} from '../src/renderer/features/assistant/AssistantPage';

describe('assistant slash Skills', () => {
  it('opens only for a slash token at the current cursor', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('请使用 /deck', 10)).toBe('deck');
    expect(slashQuery('https://example.com/', 20)).toBeNull();
    expect(slashQuery('/deck 生成内容', 5)).toBe('deck');
  });

  it('replaces the slash token and keeps the task text after the cursor', () => {
    expect(replaceSlashSkill('/de 生成一份周报', 3, 'deck-builder')).toEqual({
      value: '/deck-builder 生成一份周报',
      cursor: 14
    });
    expect(replaceSlashSkill('请 /de生成', 5, 'deck-builder')).toEqual({
      value: '请 /deck-builder 生成',
      cursor: 16
    });
  });
});
