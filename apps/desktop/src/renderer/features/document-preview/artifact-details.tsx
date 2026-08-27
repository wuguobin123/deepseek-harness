/** Registers the desktop artifact viewer in ui-conversation's details seat. */
import type { Context } from '@deepseek-ai/cordis'
import type { DetailsArtifactOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DocumentPreviewPanel } from './DocumentPreviewPanel'

function ArtifactDetails({ artifactId, sessionId }: DetailsArtifactOwnerProps & { sessionId: string }): React.JSX.Element {
  return <DocumentPreviewPanel workspaceId="" sessionId={sessionId} initialArtifactId={artifactId} />
}

/** Install the artifact details occupant after ui-conversation declares it. */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.details.artifact', () => ctx.slots.register({
    name: 'conversation.details.artifact',
  }, ArtifactDetails))
}
