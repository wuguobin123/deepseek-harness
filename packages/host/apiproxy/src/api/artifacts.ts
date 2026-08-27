/**
 * Artifact domain contract. Wire projection of the host-side artifact
 * registry (`@deepseek-ai/dsh-artifact`): durable, content-addressed
 * renderable products the harness persists across sessions.
 *
 * Method signatures are the source of truth, same as the workspace domain.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from './workspace.ts'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side artifact id brand. Declared here rather than imported from the
 * artifact package: api/ must stay browser-importable with zero host-package
 * dependencies, and the brand string matches, so both sides agree
 * structurally. Mirrors the same precedent used for {@link WorkspaceId}.
 */
export type ArtifactId = Branded<'ArtifactId'>

/**
 * Renderable product class. Matches `ArtifactKind` from the host-side seam;
 * the wire list is closed at this domain boundary so a renderer can switch
 * on the discriminant without an undefined arm.
 */
export type ArtifactKind = 'html' | 'slides' | 'doc' | 'sheet' | 'chart'

/**
 * Producer of one artifact. Matches `ArtifactSource` from the host-side seam;
 * the wire list is closed at this domain boundary so audit reads stay
 * exhaustive on the producer identifier.
 */
export type ArtifactSource =
  | 'tool-html'
  | 'tool-slides'
  | 'tool-doc'
  | 'tool-sheet'
  | 'tool-mermaid'
  | 'tool-svg'

/**
 * Wire-side MIME media type vocabulary. Closed: adding a new media type
 * requires a new arm here plus a renderer arm downstream.
 */
export type ArtifactMediaType =
  | 'text/html'
  | 'text/markdown'
  | 'image/svg+xml'
  | 'image/png'
  | 'image/jpeg'
  | 'application/pdf'

/** One artifact row carried by every `artifact.*` value. */
export interface ArtifactView {
  artifactId: ArtifactId
  kind: ArtifactKind
  source: ArtifactSource
  mediaType: ArtifactMediaType
  bytes: number
  /** Optional human-readable title; absent when the producer named none. */
  title?: string
  /** Workspace owning the artifact; absent for unowned writes. */
  workspaceId?: WorkspaceId
  /** Session that produced the artifact; absent for unowned writes. */
  sessionId?: SessionId
  /** ISO-8601 creation instant. */
  createdAt: string
  /** Optional display name; absent when the producer named none. */
  name?: string
}

/** Artifact-domain unary methods (the map keys artifact.* of RpcMethodMap). */
export interface ArtifactsApi {
  /**
   * Lists durable artifact views in newest-first order. Optional ownership
   * filters narrow the listing to one workspace, session, and/or product kind. An
   * absent workspace filter includes artifacts written outside any workspace
   * so a multi-tenant deployment can serve its full registry.
   *
   * A workspace that does not exist fails with `workspace-not-found`. The
   * listing returns an empty `items` array when no artifact matches.
   */
  list(request: RpcRequest<{
    workspaceId?: WorkspaceId
    sessionId?: SessionId
    kind?: ArtifactKind
  }>): Promise<RpcResponse<{ items: ArtifactView[] }>>

  /**
   * Reads one artifact's verified bytes plus its durable view. An unknown
   * `artifactId` fails with `artifact-not-found`; a stored object whose
   * bytes no longer match its declared reference fails with
   * `artifact-corrupt`.
   *
   * The bytes ride the wire as base64: the read path is rare (a renderer
   * fetch on a single ArtifactCard) and the base64 expansion keeps the
   * transport format homogenous with the existing attachment read path.
   */
  read(request: RpcRequest<{
    artifactId: ArtifactId
  }>): Promise<RpcResponse<{ view: ArtifactView; bytesBase64: string }>>

  /**
   * Removes one durable artifact by id. Idempotent: an absent id succeeds
   * with `{ removed: true }`. The underlying content-addressed blob may
   * remain on disk until a future retention sweep collects unreferenced
   * objects.
   */
  remove(request: RpcRequest<{
    artifactId: ArtifactId
  }>): Promise<RpcResponse<{ removed: true }>>
}
