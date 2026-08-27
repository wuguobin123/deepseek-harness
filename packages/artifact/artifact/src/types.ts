/** Durable artifact vocabulary. @module @deepseek-ai/dsh-artifact/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ArtifactId } from './brand.ts'

export type { ArtifactId } from './brand.ts'

/**
 * Owning workspace identifier, opaque and structurally equivalent to the
 * host-side `WorkspaceId` brand. Declared locally to keep the artifact seam
 * free of host-package dependencies; the store-fs implementation accepts the
 * shape and the wire layer bridges it to the host type.
 */
export type WorkspaceOwnerId = Branded<'WorkspaceId'>

/**
 * Owning session identifier, opaque and structurally equivalent to the
 * host-side `SessionId` brand. Same rationale as {@link WorkspaceOwnerId}.
 */
export type SessionOwnerId = Branded<'SessionId'>

/**
 * Renderable product classes the registry stores. Adding a new kind requires
 * a new wire field on `ArtifactRef` (mime + media subtype) plus a presenter
 * arm at the consuming `tool.call.toolview` slot.
 */
export type ArtifactKind = 'html' | 'slides' | 'doc' | 'sheet' | 'chart'

/**
 * Producer of one artifact. Identifies the tool that wrote the bytes so a
 * renderer can pick the right viewer and audit the producing call later.
 *
 * Xiaowei excludes `tool-pptx`, `tool-docx`, `tool-xlsx`, and
 * `tool-plantuml` by user product decision — products are HTML/slides/doc/
 * sheet/chart only, with slides/doc/sheet rendered as HTML source-of-truth
 * and chart producers limited to mermaid + svg.
 */
export type ArtifactSource =
  | 'tool-html'
  | 'tool-slides'
  | 'tool-doc'
  | 'tool-sheet'
  | 'tool-mermaid'
  | 'tool-svg'

/**
 * MIME media type vocabulary carried by every artifact. Wire-stable: the
 * value appears in `ArtifactRef` and survives history replay.
 *
 * Xiaowei's blessed formats only — no OOXML, no PPTX, no PlantUML.
 */
export type ArtifactMediaType =
  | 'text/html'
  | 'text/markdown'
  | 'image/svg+xml'
  | 'image/png'
  | 'image/jpeg'
  | 'application/pdf'

/** Durable, serializable reference to one immutable artifact. */
export interface ArtifactRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  artifactId: ArtifactId
  /** Product class for renderer dispatch. */
  kind: ArtifactKind
  /** Producer tool — audit trail and toolview routing. */
  source: ArtifactSource
  /** Verified MIME media type. */
  mediaType: ArtifactMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Optional human-readable title stripped of any host path. */
  title?: string
}

/** Wire projection of one artifact row used by `artifact.list`. */
export interface ArtifactView extends ArtifactRef {
  /** Workspace owning the artifact; absent when written outside a workspace. */
  workspaceId?: WorkspaceOwnerId
  /** Session that produced the artifact; absent for unowned writes. */
  sessionId?: SessionOwnerId
  /** ISO-8601 creation instant. */
  createdAt: string
  /** Optional display name (never a host path). */
  name?: string
}

/** Deployment-resolved limits for admission and request buffering. */
export interface ArtifactLimits {
  /** Maximum encoded bytes accepted for one artifact write. */
  maxArtifactBytes: number
  /** Maximum artifacts one session may publish before rotation. */
  maxArtifactsPerSession: number
  /** Media types accepted by this deployment. */
  mediaTypes: readonly ArtifactMediaType[]
}

/** Request to validate and durably commit one artifact. */
export interface WriteArtifactInput {
  /** Encoded bytes whose sha256 becomes {@link ref.artifactId}. */
  data: Uint8Array
  /** Caller-declared product class; verified against bytes during admission. */
  kind: ArtifactKind
  /** Producer tool identifier. */
  source: ArtifactSource
  /** Declared MIME media type; checked against fully decoded bytes. */
  mediaType: ArtifactMediaType
  /** Optional human-readable title; never interpreted as a path. */
  title?: string
  /** Optional workspace ownership. */
  workspaceId?: WorkspaceOwnerId
  /** Optional producing session. */
  sessionId?: SessionOwnerId
  /** Optional display name stripped of host path. */
  name?: string
}

/** Stored artifact bytes returned after reference and digest verification. */
export interface StoredArtifact {
  /** Full durable view the registry persists beside the bytes. */
  view: ArtifactView
  /** Verified content-addressed bytes. */
  data: Uint8Array
}
