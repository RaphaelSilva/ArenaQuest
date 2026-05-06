import type {
  ITopicNodeRepository,
  IMediaRepository,
  IStorageAdapter,
  IEnrollmentRepository,
  TopicNodeRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '../core/result';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOWNLOAD_URL_TTL = 3600;

// ---------------------------------------------------------------------------
// Result payload types
// ---------------------------------------------------------------------------

export type TopicWithMedia = TopicNodeRecord & { children: TopicNodeRecord[]; media: Entities.Content.Media[] };

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class TopicsController {
  constructor(
    private readonly topics: ITopicNodeRepository,
    private readonly media: IMediaRepository,
    private readonly storage: IStorageAdapter,
    private readonly enrollment: IEnrollmentRepository | null = null,
  ) {}

  async listPublished(userId?: string): Promise<ControllerResult<TopicNodeRecord[]>> {
    const all = await this.topics.listAll();
    let published = all.filter(
      n => n.status === Entities.Config.TopicNodeStatus.PUBLISHED && !n.archived,
    );

    if (userId && this.enrollment) {
      const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
      const effectiveSet = new Set(effectiveIds);
      published = published.filter(n => effectiveSet.has(n.id));
    }

    return { ok: true, data: published };
  }

  async getPublishedById(id: string, userId?: string): Promise<ControllerResult<TopicWithMedia>> {
    const node = await this.topics.findById(id);
    if (!node || node.status !== Entities.Config.TopicNodeStatus.PUBLISHED || node.archived) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    if (userId && this.enrollment) {
      const effectiveIds = await this.enrollment.getEffectiveAccessTopicIds(userId);
      if (!effectiveIds.includes(id)) {
        return { ok: false, status: 404, error: 'NotFound' };
      }
    }

    const [children, mediaItems] = await Promise.all([
      this.topics.listChildren(id),
      this.media.listByTopic(id),
    ]);

    const publishedChildren = children.filter(
      n => n.status === Entities.Config.TopicNodeStatus.PUBLISHED && !n.archived,
    );

    const mediaWithUrls = await Promise.all(
      mediaItems.map(async (m): Promise<Entities.Content.Media> => ({
        ...m,
        url: await this.storage.getPresignedDownloadUrl(m.storageKey, { expiresInSeconds: DOWNLOAD_URL_TTL }),
      })),
    );

    return { ok: true, data: { ...node, children: publishedChildren, media: mediaWithUrls } };
  }
}
