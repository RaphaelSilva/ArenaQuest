import { Hono } from 'hono';
import { z } from 'zod';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ITopicNodeRepository, IMediaRepository, IStorageAdapter } from '@arenaquest/shared/ports';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = ['application/pdf', 'video/mp4', 'image/jpeg', 'image/png', 'image/webp'] as const;

const SIZE_LIMIT_BYTES: Record<string, number> = {
  'application/pdf': 25 * 1024 * 1024,   // 25 MB
  'video/mp4':       100 * 1024 * 1024,  // 100 MB
  'image/jpeg':      5 * 1024 * 1024,    //   5 MB
  'image/png':       5 * 1024 * 1024,
  'image/webp':      5 * 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PresignSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_TYPES),
  sizeBytes: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts an arbitrary filename into a safe, lowercase, hyphenated slug. */
function sanitizeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || 'file';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Mounted at /admin/topics in AppRouter.
 * Handles /admin/topics/:topicId/media/* paths.
 */
export function buildAdminMediaRouter(
  topics: ITopicNodeRepository,
  media: IMediaRepository,
  storage: IStorageAdapter,
): Hono {
  const router = new Hono();

  router.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // GET /admin/topics/:topicId/media
  // Lists all media for a topic, including pending uploads.
  router.get('/:topicId/media', async (c) => {
    const topicId = c.req.param('topicId');
    
    const topic = await topics.findById(topicId);
    if (!topic) return c.json({ error: 'NotFound', detail: 'topic not found' }, 404);

    const mediaItems = await media.listByTopic(topicId, { includePending: true });

    // Resolve presigned download URLs for all ready media items in parallel.
    const mediaWithUrls = await Promise.all(
      mediaItems.map(async (m) => {
        if (m.status === Entities.Config.MediaStatus.READY) {
          return {
            ...m,
            url: await storage.getPresignedDownloadUrl(m.storageKey, { expiresInSeconds: 3600 }),
          };
        }
        return m;
      }),
    );

    return c.json({ data: mediaWithUrls });
  });

  // POST /admin/topics/:topicId/media/presign
  // Generates a presigned upload URL and creates a pending media record.
  router.post('/:topicId/media/presign', async (c) => {
    const topicId = c.req.param('topicId');

    const topic = await topics.findById(topicId);
    if (!topic) return c.json({ error: 'NotFound', detail: 'topic not found' }, 404);

    const body = await c.req.json();
    const parsed = PresignSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
    }

    const { fileName, contentType, sizeBytes } = parsed.data;

    const maxBytes = SIZE_LIMIT_BYTES[contentType];
    if (sizeBytes > maxBytes) {
      return c.json(
        { error: 'FileTooLarge', detail: `${contentType} files must be ≤ ${maxBytes / (1024 * 1024)} MB`, maxBytes },
        422,
      );
    }

    // Pre-generate the UUID so the storage key embeds the same ID that lands in the DB.
    const mediaId = crypto.randomUUID();
    const safeName = sanitizeFileName(fileName);
    const storageKey = `topics/${topicId}/${mediaId}-${safeName}`;

    const uploadUrl = await storage.getPresignedUploadUrl(storageKey, {
      expiresInSeconds: 3600,
      contentType,
      maxSizeBytes: sizeBytes,
    });

    const record = await media.create({
      id: mediaId,
      topicNodeId: topicId,
      storageKey,
      sizeBytes,
      originalName: fileName,
      type: contentType,
      uploadedById: c.get('user').sub,
    });

    return c.json({ uploadUrl, media: record }, 201);
  });

  // POST /admin/topics/:topicId/media/:mediaId/finalize
  // Verifies the object was uploaded to R2 and transitions status to ready.
  // Idempotent: safe to call multiple times.
  router.post('/:topicId/media/:mediaId/finalize', async (c) => {
    const topicId = c.req.param('topicId');
    const mediaId = c.req.param('mediaId');

    const record = await media.findById(mediaId);
    if (!record || record.topicNodeId !== topicId) {
      return c.json({ error: 'NotFound' }, 404);
    }

    // Idempotent: return current record if already finalized.
    if (record.status === Entities.Config.MediaStatus.READY) {
      return c.json(record);
    }

    const exists = await storage.objectExists(record.storageKey);
    if (!exists) {
      return c.json({ error: 'NotUploaded', detail: 'object not found in storage; complete the upload first' }, 422);
    }

    const updated = await media.markReady(mediaId);
    return c.json(updated);
  });

  // DELETE /admin/topics/:topicId/media/:mediaId
  // Soft-deletes the DB record then attempts to remove the R2 object.
  // DB is updated first to avoid broken references on partial failure.
  router.delete('/:topicId/media/:mediaId', async (c) => {
    const topicId = c.req.param('topicId');
    const mediaId = c.req.param('mediaId');

    const record = await media.findById(mediaId);
    if (!record || record.topicNodeId !== topicId) {
      return c.json({ error: 'NotFound' }, 404);
    }

    // DB update before storage to prevent orphan files or broken references.
    await media.softDelete(mediaId);
    await storage.deleteObject(record.storageKey).catch(() => {});

    return c.body(null, 204);
  });

  return router;
}
