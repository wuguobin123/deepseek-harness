export interface GeneratedFileArtifact {
  artifactId: string;
  displayName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  artifactType?: string;
}

export interface GeneratedFileRow {
  artifact: GeneratedFileArtifact;
}

function extension(displayName: string): string {
  return displayName.split('.').pop()?.toLowerCase() || '';
}

export function isHtmlGeneratedFile(artifact: GeneratedFileArtifact): boolean {
  return ['html', 'htm'].includes(extension(artifact.displayName));
}

function stem(displayName: string): string {
  return displayName.replace(/\.[^.]+$/, '').toLowerCase();
}

/** Collapse a generated HTML + PPTX pair into one HTML delivery row. */
export function generatedFileRows(
  artifacts: GeneratedFileArtifact[]
): GeneratedFileRow[] {
  const presentations = artifacts.filter((artifact) =>
    ['ppt', 'pptx'].includes(extension(artifact.displayName))
  );
  const pairedPresentationIds = new Set<string>();

  for (const artifact of artifacts) {
    if (!isHtmlGeneratedFile(artifact)) continue;
    const presentation = presentations.find(
      (candidate) => stem(candidate.displayName) === stem(artifact.displayName)
    );
    if (!presentation) continue;
    pairedPresentationIds.add(presentation.artifactId);
  }

  return artifacts
    .filter((artifact) => !pairedPresentationIds.has(artifact.artifactId))
    .map((artifact) => ({ artifact }));
}
