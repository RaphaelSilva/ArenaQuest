import { z } from 'zod';
import type { ITopicNodeRepository, ITagRepository, TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import { slugify } from '@arenaquest/shared/domain/tags/slugify';
import type { ControllerResult } from '@api/core/result';


// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TOPIC_STATUS_VALUES = ['draft', 'published', 'archived'] as const;
const TOPIC_VISIBILITY_VALUES = ['public', 'restricted', 'private'] as const;

export const TAG_NAME_MAX_LENGTH = 40;
export const TAG_NAMES_MAX_COUNT = 20;

/** Tag names: each 1–40 characters after trim, at most 20 per request. */
export const TagNamesSchema = z
  .array(z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH))
  .max(TAG_NAMES_MAX_COUNT);

export const CreateTopicSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  visibility: z.enum(TOPIC_VISIBILITY_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
  tags: TagNamesSchema.optional(),
  prerequisiteIds: z.array(z.string()).optional(),
});

export const UpdateTopicSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  visibility: z.enum(TOPIC_VISIBILITY_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
  tags: TagNamesSchema.optional(),
  prerequisiteIds: z.array(z.string()).optional(),
});

export const MoveTopicSchema = z.object({
  newParentId: z.string().nullable(),
  newSortOrder: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Result payload types
// ---------------------------------------------------------------------------

export type TopicWithChildren = TopicNodeRecord & { children: TopicNodeRecord[] };

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AdminTopicsController {
  constructor(
    private readonly topics: ITopicNodeRepository,
    private readonly tags: ITagRepository,
  ) {}

  /**
   * Validates the tag fields of a create/update body and turns them into the
   * tag IDs to link. `undefined` means "leave the links alone" (PATCH without
   * either field). Unknown IDs and unusable names are rejected here, before
   * anything is written; the only write this performs is the tag upsert, which
   * runs after every other check has passed (see `prepareTagIds`).
   */
  private async validateTags(
    body: { tags?: string[]; tagIds?: string[] },
  ): Promise<ControllerResult<{ ids?: string[]; toUpsert?: { name: string; slug: string }[] }>> {
    const { tags, tagIds } = body;

    if (tags !== undefined && tagIds !== undefined) {
      return { ok: false, status: 400, error: 'BadRequest', meta: { detail: 'send either tags or tagIds, not both' } };
    }

    if (tags !== undefined) {
      const bySlug = new Map<string, { name: string; slug: string }>();
      for (const raw of tags) {
        const name = raw.trim();
        const slug = slugify(name);
        if (!slug) {
          return { ok: false, status: 400, error: 'BadRequest', meta: { detail: `tag "${name}" has no usable characters` } };
        }
        // De-duplicate by slug, keeping the first spelling in the request.
        if (!bySlug.has(slug)) bySlug.set(slug, { name, slug });
      }
      return { ok: true, data: { toUpsert: [...bySlug.values()] } };
    }

    if (tagIds !== undefined) {
      const unique = [...new Set(tagIds)];
      if (unique.length > 0) {
        const found = new Set((await this.tags.findByIds(unique)).map(t => t.id));
        const missing = unique.find(id => !found.has(id));
        if (missing !== undefined) {
          return { ok: false, status: 422, error: 'UNKNOWN_TAG', meta: { detail: `tag ${missing} not found` } };
        }
      }
      return { ok: true, data: { ids: unique } };
    }

    return { ok: true, data: {} };
  }

  /** Performs the tag upsert (if any) and returns the IDs to link. */
  private async prepareTagIds(
    plan: { ids?: string[]; toUpsert?: { name: string; slug: string }[] },
  ): Promise<string[] | undefined> {
    if (plan.toUpsert === undefined) return plan.ids;
    if (plan.toUpsert.length === 0) return [];

    const stored = await this.tags.upsertMany(plan.toUpsert);
    const idBySlug = new Map(stored.map(t => [t.slug, t.id]));
    return plan.toUpsert
      .map(t => idBySlug.get(t.slug))
      .filter((id): id is string => id !== undefined);
  }

  private async validatePrerequisites(prerequisiteIds?: string[]): Promise<ControllerResult<null>> {
    for (const prereqId of prerequisiteIds ?? []) {
      const prereq = await this.topics.findById(prereqId);
      if (!prereq) {
        return { ok: false, status: 422, error: 'UNKNOWN_PREREQ', meta: { detail: `prerequisite ${prereqId} not found` } };
      }
    }
    return { ok: true, data: null };
  }

  async listAll(): Promise<ControllerResult<TopicNodeRecord[]>> {
    const nodes = await this.topics.listAll();
    return { ok: true, data: nodes };
  }

  async create(body: z.infer<typeof CreateTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    const { parentId, title, content, status, visibility, estimatedMinutes, prerequisiteIds } = body;

    const tagPlan = await this.validateTags(body);
    if (!tagPlan.ok) return tagPlan;

    if (parentId) {
      const parent = await this.topics.findById(parentId);
      if (!parent) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'parentId not found' } };
    }

    const prereqs = await this.validatePrerequisites(prerequisiteIds);
    if (!prereqs.ok) return prereqs;

    // Every check has passed: the tag upsert is the first write.
    const tagIds = await this.prepareTagIds(tagPlan.data);

    const node = await this.topics.create({
      parentId,
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
      visibility: visibility as Entities.Config.TopicVisibility,
      estimatedMinutes,
      tagIds,
      prerequisiteIds,
    });

    return { ok: true, data: node };
  }

  async getById(id: string): Promise<ControllerResult<TopicWithChildren>> {
    const [node, children] = await Promise.all([
      this.topics.findById(id),
      this.topics.listChildren(id),
    ]);
    if (!node) return { ok: false, status: 404, error: 'NotFound' };
    return { ok: true, data: { ...node, children } };
  }

  async update(id: string, body: z.infer<typeof UpdateTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    const existing = await this.topics.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    const { title, content, status, visibility, estimatedMinutes, prerequisiteIds } = body;

    const tagPlan = await this.validateTags(body);
    if (!tagPlan.ok) return tagPlan;

    const prereqs = await this.validatePrerequisites(prerequisiteIds);
    if (!prereqs.ok) return prereqs;

    // Every check has passed: the tag upsert is the first write.
    const tagIds = await this.prepareTagIds(tagPlan.data);

    const node = await this.topics.update(id, {
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
      visibility: visibility as Entities.Config.TopicVisibility,
      estimatedMinutes,
      tagIds,
      prerequisiteIds,
    });

    return { ok: true, data: node };
  }

  async move(id: string, body: z.infer<typeof MoveTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    const existing = await this.topics.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    const { newParentId, newSortOrder } = body;

    if (newParentId === id) {
      return { ok: false, status: 409, error: 'WOULD_CYCLE' };
    }

    if (newParentId !== null) {
      const parent = await this.topics.findById(newParentId);
      if (!parent) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'newParentId not found' } };

      const cycle = await this.topics.wouldCreateCycle(id, newParentId);
      if (cycle) return { ok: false, status: 409, error: 'WOULD_CYCLE' };
    }

    const node = await this.topics.move(id, newParentId, newSortOrder);
    return { ok: true, data: node };
  }

  async archive(id: string): Promise<ControllerResult<null>> {
    const existing = await this.topics.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    await this.topics.archive(id);
    return { ok: true, data: null };
  }
}
