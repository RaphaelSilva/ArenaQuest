import { z } from 'zod';
import type { ITopicNodeRepository, IMediaRepository, IStorageAdapter } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import {
  ALLOWED_MEDIA_TYPES,
  MEDIA_SIZE_LIMIT_BYTES,
} from '@arenaquest/shared/domain/media/limits';
import { sanitizeFileName } from '@arenaquest/shared/utils/sanitize-file-name';


// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------
//
// The allowed types and their ceilings live in `@arenaquest/shared/domain/media`
// — the single source of truth this file used to hold as a literal. The values
// are unchanged; `ALLOWED_MEDIA_TYPES` is a readonly tuple, so `z.enum` still
// narrows `contentType` to the same five literals and the route contract is
// byte-identical.

export const PresignSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_MEDIA_TYPES),
  sizeBytes: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Moved to `@arenaquest/shared/utils/sanitize-file-name` (RFC 0020 §2); re-exported for existing importers. */
export { sanitizeFileName };

// ---------------------------------------------------------------------------
// Result payload types
// ---------------------------------------------------------------------------

export type PresignResult = { uploadUrl: string; media: Entities.Content.Media };

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AdminMediaController {
  constructor(
    private readonly topics: ITopicNodeRepository,
    private readonly media: IMediaRepository,
    private readonly storage: IStorageAdapter,
  ) {}

  async listMedia(topicId: string): Promise<ControllerResult<Entities.Content.Media[]>> {
    const topic = await this.topics.findById(topicId);
    if (!topic) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'topic not found' } };

    const mediaItems = await this.media.listByTopic(topicId, { includePending: true });

    const mediaWithUrls = await Promise.all(
      mediaItems.map(async (m): Promise<Entities.Content.Media> => {
        if (m.status === Entities.Config.MediaStatus.READY) {
          return { ...m, url: await this.storage.getPresignedDownloadUrl(m.storageKey, { expiresInSeconds: 3600 }) };
        }
        return m;
      }),
    );

    return { ok: true, data: mediaWithUrls };
  }

  async presignUpload(
    topicId: string,
    body: z.infer<typeof PresignSchema>,
    userId: string,
  ): Promise<ControllerResult<PresignResult>> {
    const topic = await this.topics.findById(topicId);
    if (!topic) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'topic not found' } };

    const { fileName, contentType, sizeBytes } = body;
    const maxBytes = MEDIA_SIZE_LIMIT_BYTES[contentType];
    if (sizeBytes > maxBytes) {
      return {
        ok: false,
        status: 422,
        error: 'FileTooLarge',
        meta: { detail: `${contentType} files must be ≤ ${maxBytes / (1024 * 1024)} MB`, maxBytes },
      };
    }

    const mediaId = crypto.randomUUID();
    const safeName = sanitizeFileName(fileName);
    const storageKey = `topics/${topicId}/${mediaId}-${safeName}`;

    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, {
      expiresInSeconds: 3600,
      contentType,
      maxSizeBytes: sizeBytes,
    });

    const record = await this.media.create({
      id: mediaId,
      topicNodeId: topicId,
      storageKey,
      sizeBytes,
      originalName: fileName,
      type: contentType,
      uploadedById: userId,
    });

    return { ok: true, data: { uploadUrl, media: record } };
  }

  async finalizeUpload(topicId: string, mediaId: string): Promise<ControllerResult<Entities.Content.Media>> {
    const record = await this.media.findById(mediaId);
    if (!record || record.topicNodeId !== topicId) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    if (record.status === Entities.Config.MediaStatus.READY) {
      return { ok: true, data: record };
    }

    const exists = await this.storage.objectExists(record.storageKey);
    if (!exists) {
      return {
        ok: false,
        status: 422,
        error: 'NotUploaded',
        meta: { detail: 'object not found in storage; complete the upload first' },
      };
    }

    const updated = await this.media.markReady(mediaId);
    return { ok: true, data: updated };
  }

  async deleteMedia(topicId: string, mediaId: string): Promise<ControllerResult<null>> {
    const record = await this.media.findById(mediaId);
    if (!record || record.topicNodeId !== topicId) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    // DB update before storage to prevent orphan files or broken references.
    await this.media.softDelete(mediaId);
    await this.storage.deleteObject(record.storageKey).catch(() => {});

    return { ok: true, data: null };
  }

  /**
   * Logical transfer of a READY media item to another topic: only the row's
   * topic changes. The storage object is neither copied nor renamed — its key
   * keeps the original topic id, and ownership is resolved from the database.
   */
  async moveMedia(
    topicId: string,
    mediaId: string,
    targetTopicId: string,
  ): Promise<ControllerResult<Entities.Content.Media>> {
    if (targetTopicId === topicId) {
      return { ok: false, status: 400, error: 'SameTopic', meta: { detail: 'target topic equals the current topic' } };
    }

    const record = await this.media.findById(mediaId);
    const notReady = this.moveRejection(record, topicId);
    if (notReady) return notReady;

    // Any existing topic is a valid target, archived included — the same rule
    // `presignUpload` applies to its own topic.
    const target = await this.topics.findById(targetTopicId);
    if (!target) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'target topic not found' } };

    const moved = await this.media.moveToTopic(mediaId, topicId, targetTopicId);
    if (!moved) {
      // The conditional write lost a race (deleted, moved, or no longer ready).
      const current = await this.media.findById(mediaId);
      return this.moveRejection(current, topicId) ?? { ok: false, status: 404, error: 'NotFound' };
    }

    const url = await this.storage.getPresignedDownloadUrl(moved.storageKey, { expiresInSeconds: 3600 });
    return { ok: true, data: { ...moved, url } };
  }

  /** The 404/409 answer for a media row that cannot be moved from `topicId`, or `null` when it can. */
  private moveRejection(
    record: Entities.Content.Media | null,
    topicId: string,
  ): ControllerResult<never> | null {
    if (!record || record.topicNodeId !== topicId || record.status === Entities.Config.MediaStatus.DELETED) {
      return { ok: false, status: 404, error: 'NotFound' };
    }
    if (record.status !== Entities.Config.MediaStatus.READY) {
      return { ok: false, status: 409, error: 'MediaNotReady', meta: { detail: 'only ready media can be moved' } };
    }
    return null;
  }
}
