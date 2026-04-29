import { z } from 'zod';
import type { ITopicNodeRepository, ITagRepository, TopicNodeRecord } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import type { ControllerResult } from '../core/result';
import { ValidateBody, Body } from '../core/decorators';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TOPIC_STATUS_VALUES = ['draft', 'published', 'archived'] as const;

export const CreateTopicSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
  prerequisiteIds: z.array(z.string()).optional(),
});

export const UpdateTopicSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  status: z.enum(TOPIC_STATUS_VALUES).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  tagIds: z.array(z.string()).optional(),
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
    private readonly _tags: ITagRepository,
  ) {}

  async listAll(): Promise<ControllerResult<TopicNodeRecord[]>> {
    const nodes = await this.topics.listAll();
    return { ok: true, data: nodes };
  }

  @ValidateBody(CreateTopicSchema)
  async create(@Body() body: z.infer<typeof CreateTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    const { parentId, title, content, status, estimatedMinutes, tagIds, prerequisiteIds } = body;

    if (parentId) {
      const parent = await this.topics.findById(parentId);
      if (!parent) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'parentId not found' } };
    }

    if (prerequisiteIds && prerequisiteIds.length > 0) {
      for (const prereqId of prerequisiteIds) {
        const prereq = await this.topics.findById(prereqId);
        if (!prereq) {
          return { ok: false, status: 422, error: 'UNKNOWN_PREREQ', meta: { detail: `prerequisite ${prereqId} not found` } };
        }
      }
    }

    const node = await this.topics.create({
      parentId,
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
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

  @ValidateBody(UpdateTopicSchema)
  async update(id: string, @Body() body: z.infer<typeof UpdateTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
    const existing = await this.topics.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    const { title, content, status, estimatedMinutes, tagIds, prerequisiteIds } = body;

    if (prerequisiteIds && prerequisiteIds.length > 0) {
      for (const prereqId of prerequisiteIds) {
        const prereq = await this.topics.findById(prereqId);
        if (!prereq) {
          return { ok: false, status: 422, error: 'UNKNOWN_PREREQ', meta: { detail: `prerequisite ${prereqId} not found` } };
        }
      }
    }

    const node = await this.topics.update(id, {
      title,
      content: content !== undefined ? sanitizeMarkdown(content) : undefined,
      status: status as Entities.Config.TopicNodeStatus,
      estimatedMinutes,
      tagIds,
      prerequisiteIds,
    });

    return { ok: true, data: node };
  }

  @ValidateBody(MoveTopicSchema)
  async move(id: string, @Body() body: z.infer<typeof MoveTopicSchema>): Promise<ControllerResult<TopicNodeRecord>> {
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
