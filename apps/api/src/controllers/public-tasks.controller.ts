import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
  IEnrollmentRepository,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '../core/result';

export type TaskSummary = {
  id: string;
  title: string;
  stageCount: number;
  topicCount: number;
  updatedAt: string;
};

export type PublicStage = {
  id: string;
  label: string;
  order: number;
  topics: { id: string; title: string }[];
};

export type PublicTaskDetail = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  stages: PublicStage[];
};

export class PublicTasksController {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly stages: ITaskStageRepository,
    private readonly links: ITaskLinkingRepository,
    private readonly topics: ITopicNodeRepository,
    private readonly enrollment: IEnrollmentRepository | null = null,
  ) {}

  /**
   * Builds a Set of effective topic IDs for the given user.
   * Returns null when enrollment filtering is disabled (admin/content_creator bypass).
   */
  private async effectiveSet(userId: string | null): Promise<Set<string> | null> {
    if (!userId || !this.enrollment) return null;
    const ids = await this.enrollment.getEffectiveAccessTopicIds(userId);
    return new Set(ids);
  }

  async list(
    opts: { limit?: number; offset?: number },
    userId?: string,
  ): Promise<ControllerResult<TaskSummary[]>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const tasks = await this.tasks.list({
      status: Entities.Config.TaskStatus.PUBLISHED,
      limit,
      offset,
    });

    const access = await this.effectiveSet(userId ?? null);

    const summaries = await Promise.all(
      tasks.map(async (task): Promise<TaskSummary | null> => {
        const [stagesList, topicIds] = await Promise.all([
          this.stages.listByTask(task.id),
          this.links.listTaskTopics(task.id),
        ]);
        // Access filter: task is visible only if ALL linked topics are accessible.
        if (access && topicIds.some((tid) => !access.has(tid))) return null;
        return {
          id: task.id,
          title: task.title,
          stageCount: stagesList.length,
          topicCount: topicIds.length,
          updatedAt: task.updatedAt,
        };
      }),
    );

    return { ok: true, data: summaries.filter((s): s is TaskSummary => s !== null) };
  }

  async getById(id: string, userId?: string): Promise<ControllerResult<PublicTaskDetail>> {
    const task = await this.tasks.findById(id);
    if (!task || task.status !== Entities.Config.TaskStatus.PUBLISHED) {
      return { ok: false, status: 404, error: 'NotFound' };
    }

    // Access filter: verify all task topics are in the effective set
    if (userId && this.enrollment) {
      const [effectiveIds, taskTopicIds] = await Promise.all([
        this.enrollment.getEffectiveAccessTopicIds(userId),
        this.links.listTaskTopics(id),
      ]);
      const effectiveSet = new Set(effectiveIds);
      if (taskTopicIds.some((tid) => !effectiveSet.has(tid))) {
        return { ok: false, status: 404, error: 'NotFound' };
      }
    }

    const [stagesList, hydration] = await Promise.all([
      this.stages.listByTask(id),
      this.links.hydrate(id),
    ]);

    const stageTopics = new Map<string, string[]>();
    for (const entry of hydration.stages) {
      stageTopics.set(entry.stageId, entry.topicIds);
    }

    const stages: PublicStage[] = await Promise.all(
      stagesList.map(async (stage): Promise<PublicStage> => {
        const topicIds = stageTopics.get(stage.id) ?? [];
        const topics = await Promise.all(topicIds.map(tid => this.topics.findById(tid)));
        // Stale-link handling: drop topics that are missing or no longer published.
        const published = topics.filter(
          (t): t is NonNullable<typeof t> =>
            t !== null && t.status === Entities.Config.TopicNodeStatus.PUBLISHED,
        );
        return {
          id: stage.id,
          label: stage.label,
          order: stage.order,
          topics: published.map(t => ({ id: t.id, title: t.title })),
        };
      }),
    );

    return {
      ok: true,
      data: {
        id: task.id,
        title: task.title,
        description: task.description,
        updatedAt: task.updatedAt,
        stages,
      },
    };
  }
}
