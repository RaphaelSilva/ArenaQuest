import { Hono } from 'hono';
import { authGuard } from '@api/middleware/auth-guard';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ITopicNodeRepository, IMediaRepository, IStorageAdapter } from '@arenaquest/shared/ports';

const CACHE_CONTROL = 'private, max-age=30';
const DOWNLOAD_URL_TTL = 3600;

export function buildTopicsRouter(
  topics: ITopicNodeRepository,
  media: IMediaRepository,
  storage: IStorageAdapter,
): Hono {
  const router = new Hono();

  router.use('*', authGuard);

  // GET /topics — published catalogue tree, all statuses except draft/archived
  router.get('/', async (c) => {
    const all = await topics.listAll();
    const published = all.filter(
      n => n.status === Entities.Config.TopicNodeStatus.PUBLISHED && !n.archived,
    );
    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ data: published });
  });

  // GET /topics/:id — single published topic with published children and ready media
  router.get('/:id', async (c) => {
    const id = c.req.param('id');

    const node = await topics.findById(id);
    if (!node || node.status !== Entities.Config.TopicNodeStatus.PUBLISHED || node.archived) {
      return c.json({ error: 'NotFound' }, 404);
    }

    const [children, mediaItems] = await Promise.all([
      topics.listChildren(id),
      media.listByTopic(id),
    ]);

    const publishedChildren = children.filter(
      n => n.status === Entities.Config.TopicNodeStatus.PUBLISHED && !n.archived,
    );

    // Resolve presigned download URLs for all ready media items in parallel.
    const mediaWithUrls = await Promise.all(
      mediaItems.map(async (m) => ({
        ...m,
        url: await storage.getPresignedDownloadUrl(m.storageKey, { expiresInSeconds: DOWNLOAD_URL_TTL }),
      })),
    );

    c.header('Cache-Control', CACHE_CONTROL);
    return c.json({ ...node, children: publishedChildren, media: mediaWithUrls });
  });

  return router;
}
