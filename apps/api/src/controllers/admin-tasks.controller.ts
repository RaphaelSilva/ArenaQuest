import { z } from 'zod';
import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
  TaskRecord,
  TaskStageRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import type { ControllerResult } from '../core/result';
import { ValidateBody, Body } from '../core/decorators';

const TASK_STATUS_VALUES = ['draft', 'published', 'archived'] as const;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
});

export const ListTasksSchema = z.object({
  status: z.enum(TASK_STATUS_VALUES).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export type TaskDetail = TaskRecord & {
  stages: TaskStageRecord[];
  taskTopicIds: string[];
  stageTopicIds: Record<string, string[]>;
};

type Reason = 'NO_STAGES' | 'LINKED_TOPIC_NOT_PUBLISHED';

export class AdminTasksController {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly stages: ITaskStageRepository,
    private readonly links: ITaskLinkingRepository,
    private readonly topics: ITopicNodeRepository,
  ) {}

  async list(query: { status?: string; limit?: number; offset?: number }): Promise<ControllerResult<TaskRecord[]>> {
    const parsed = ListTasksSchema.safeParse(query);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'BadRequest', meta: { details: parsed.error.flatten() } };
    }
    const data = await this.tasks.list({
      status: parsed.data.status as Entities.Config.TaskStatus | undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return { ok: true, data };
  }

  @ValidateBody(CreateTaskSchema)
  async create(
    @Body() body: z.infer<typeof CreateTaskSchema>,
    createdBy: string,
  ): Promise<ControllerResult<TaskRecord>> {
    const description = body.description !== undefined ? sanitizeMarkdown(body.description) : undefined;
    const task = await this.tasks.create({
      title: body.title,
      description,
      createdBy,
    });
    return { ok: true, data: task };
  }

  async getById(id: string): Promise<ControllerResult<TaskDetail>> {
    const task = await this.tasks.findById(id);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const [stagesList, hydration] = await Promise.all([
      this.stages.listByTask(id),
      this.links.hydrate(id),
    ]);

    const stageTopicIds: Record<string, string[]> = {};
    for (const entry of hydration.stages) {
      stageTopicIds[entry.stageId] = entry.topicIds;
    }

    return {
      ok: true,
      data: {
        ...task,
        stages: stagesList,
        taskTopicIds: hydration.taskTopicIds,
        stageTopicIds,
      },
    };
  }

  @ValidateBody(UpdateTaskSchema)
  async update(
    id: string,
    @Body() body: z.infer<typeof UpdateTaskSchema>,
  ): Promise<ControllerResult<TaskRecord>> {
    const existing = await this.tasks.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    const nextStatus = body.status as Entities.Config.TaskStatus | undefined;

    if (nextStatus && nextStatus !== existing.status) {
      const transitionError = this.checkTransition(existing.status, nextStatus);
      if (transitionError) return transitionError;

      if (nextStatus === Entities.Config.TaskStatus.PUBLISHED) {
        const reasons = await this.collectPublishBlockers(id);
        if (reasons.length > 0) {
          return {
            ok: false,
            status: 409,
            error: 'TASK_NOT_PUBLISHABLE',
            meta: { reasons },
          };
        }
      }
    }

    const description = body.description !== undefined ? sanitizeMarkdown(body.description) : undefined;
    const updated = await this.tasks.update(id, {
      title: body.title,
      description,
      status: nextStatus,
    });
    return { ok: true, data: updated };
  }

  /** Soft-archive: sets status to `archived`. */
  async archive(id: string): Promise<ControllerResult<null>> {
    const existing = await this.tasks.findById(id);
    if (!existing) return { ok: false, status: 404, error: 'NotFound' };

    if (existing.status !== Entities.Config.TaskStatus.ARCHIVED) {
      await this.tasks.update(id, { status: Entities.Config.TaskStatus.ARCHIVED });
    }
    return { ok: true, data: null };
  }

  private checkTransition(
    from: Entities.Config.TaskStatus,
    to: Entities.Config.TaskStatus,
  ): ControllerResult<never> | null {
    const allowed: Record<Entities.Config.TaskStatus, Entities.Config.TaskStatus[]> = {
      [Entities.Config.TaskStatus.DRAFT]: [Entities.Config.TaskStatus.PUBLISHED, Entities.Config.TaskStatus.ARCHIVED],
      [Entities.Config.TaskStatus.PUBLISHED]: [Entities.Config.TaskStatus.ARCHIVED],
      [Entities.Config.TaskStatus.ARCHIVED]: [Entities.Config.TaskStatus.DRAFT],
    };
    if (!allowed[from].includes(to)) {
      return {
        ok: false,
        status: 409,
        error: 'INVALID_TRANSITION',
        meta: { from, to },
      };
    }
    return null;
  }

  private async collectPublishBlockers(taskId: string): Promise<Reason[]> {
    const reasons: Reason[] = [];
    const [stagesList, taskTopicIds] = await Promise.all([
      this.stages.listByTask(taskId),
      this.links.listTaskTopics(taskId),
    ]);
    if (stagesList.length === 0) reasons.push('NO_STAGES');

    if (taskTopicIds.length > 0) {
      const checks = await Promise.all(taskTopicIds.map(id => this.topics.findById(id)));
      const allPublished = checks.every(
        node => node !== null && node.status === Entities.Config.TopicNodeStatus.PUBLISHED,
      );
      if (!allPublished) reasons.push('LINKED_TOPIC_NOT_PUBLISHED');
    }
    return reasons;
  }
}
