import { describe, expect, it } from 'vitest';
import {
  generatedFileRows,
  isHtmlGeneratedFile
} from '../src/renderer/features/assistant/generated-files';

describe('generated file delivery rows', () => {
  it('shows an HTML and PPTX pair as one HTML row', () => {
    const rows = generatedFileRows([
      { artifactId: 'ART-HTML', displayName: 'FDE.html' },
      { artifactId: 'ART-PPTX', displayName: 'FDE.pptx' }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].artifact.artifactId).toBe('ART-HTML');
    expect(isHtmlGeneratedFile(rows[0].artifact)).toBe(true);
  });

  it('does not hide a presentation that is unrelated to the HTML file', () => {
    const rows = generatedFileRows([
      { artifactId: 'ART-HTML', displayName: 'report.html' },
      { artifactId: 'ART-PPTX', displayName: 'quarterly-review.pptx' }
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.artifact.artifactId)).toEqual([
      'ART-HTML',
      'ART-PPTX'
    ]);
  });
});
