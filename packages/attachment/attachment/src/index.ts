/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
  DocumentAttachmentRef, SaveDocumentAttachment, StoredDocumentAttachment,
  DocumentAttachmentLimits,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedImages } from './admission.ts'
export { admitEncodedDocuments } from './admission.ts'
export type {
  AttachmentId as AttachmentIdType,
  EncodedImageAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
  DocumentAttachmentRef, SaveDocumentAttachment, StoredDocumentAttachment, DocumentMediaType, DocumentAttachmentLimits,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits
  /** Deployment-resolved PDF and Office upload policy; providers opt in with non-zero limits. */
  readonly documentLimits: DocumentAttachmentLimits = Object.freeze({
    maxDocumentBytes: 0,
    maxDocumentsPerMessage: 0,
    maxMessageDocumentBytes: 0,
    mediaTypes: Object.freeze([]),
  })

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * The returned reference describes the persisted normalized image. When
   * normalization reduces the raster, its `originalDimensions` records the
   * orientation-applied input dimensions.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns the durable content-addressed normalized image reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Persist original document bytes after format admission.
   * @param _input - verified document bytes and declaration.
   * @returns the durable content-addressed reference.
   */
  saveDocument(_input: SaveDocumentAttachment): Promise<DocumentAttachmentRef> {
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot store documents.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

  /**
   * Validate and durably commit one ordered document batch.
   * @param inputs - decoded documents in owning-message order.
   * @returns durable references in the same order.
   */
  async saveDocuments(inputs: readonly SaveDocumentAttachment[]): Promise<readonly DocumentAttachmentRef[]> {
    if (inputs.length === 0) return []
    const { maxDocumentsPerMessage, maxMessageDocumentBytes, mediaTypes } = this.documentLimits
    if (inputs.length > maxDocumentsPerMessage) throw new AttachmentError('Document batch exceeds the configured count limit.', 'DOCUMENT_TOO_LARGE')
    if (inputs.reduce((sum, input) => sum + input.data.byteLength, 0) > maxMessageDocumentBytes) throw new AttachmentError('Document batch exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
    for (const input of inputs) {
      if (input.data.byteLength > this.documentLimits.maxDocumentBytes) throw new AttachmentError('Document exceeds the configured byte limit.', 'DOCUMENT_TOO_LARGE')
      if (!mediaTypes.includes(input.mediaType)) throw new AttachmentError(`Document type ${input.mediaType} is not accepted by this deployment.`, 'DOCUMENT_UNSUPPORTED')
    }
    const refs: DocumentAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveDocument(input))
    return refs
  }

  /**
   * Read and integrity-check a previously persisted document.
   * @param _ref - durable reference recorded by a Session.
   * @param _signal - optional cancellation for storage reads.
   * @returns verified original document bytes.
   */
  readDocument(_ref: DocumentAttachmentRef, _signal?: AbortSignal): Promise<StoredDocumentAttachment> {
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot read documents.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and normalized attachment reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Generate or read one deterministic model-request version from the stored normalized image.
   * @param ref - durable provider-independent normalized attachment reference.
   * @param policy - exact route pixel and encoded-byte budget.
   * @param signal - optional cancellation.
   * @returns request bytes and the cache/upload identity covering every transform input.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
