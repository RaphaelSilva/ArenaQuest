import { z } from 'zod';
import {
  type ITaskRepository,
  type ITaskStageRepository,
  type ITaskLinkingRepository,
  type ITopicNodeRepository,
  StageTopicNotInTaskError,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '../core/result';
import { ValidateBody, Body } from '../core/decorators';

export const ReplaceTopicsSchema = z.object({
  topicIds: z.array(z.string()),
});

type Schema = z.infer<typeof ReplaceTopicsSchema>;

export class AdminTaskLinkingController {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly stages: ITaskStageRepository,
    private readonly links: ITaskLinkingRepository,
    private readonly topics: ITopicNodeRepository,
  ) {}

  @ValidateBody(ReplaceTopicsSchema)
  async replaceTaskTopics(
    taskId: string,
    @Body() body: Schema,
  ): Promise<ControllerResult<{ topicIds: string[] }>> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const incoming = Array.from(new Set(body.topicIds));
    const validation = await this.validateTopics(incoming, task.status);
    if (validation) return validation;

    await this.links.setTaskTopics(taskId, incoming);

    // Cascade-shrink: prune any stage-level link that references a removed topic.
    const incomingSet = new Set(incoming);
    const stagesList = await this.stages.listByTask(taskId);
    for (const stage of stagesList) {
      const current = await this.links.listStageTopics(stage.id);
      const next = current.filter(id => incomingSet.has(id));
      if (next.length !== current.length) {
        await this.links.setStageTopics(stage.id, next);
      }
    }

    return { ok: true, data: { topicIds: incoming } };
  }

  @ValidateBody(ReplaceTopicsSchema)
  async replaceStageTopics(
    taskId: string,
    stageId: string,
    @Body() body: Schema,
  ): Promise<ControllerResult<{ topicIds: string[] }>> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const stage = await this.stages.findById(stageId);
    if (!stage || stage.taskId !== taskId) return { ok: false, status: 404, error: 'NotFound' };

    const incoming = Array.from(new Set(body.topicIds));
    const validation = await this.validateTopics(incoming, task.status);
    if (validation) return validation;

    try {
      await this.links.setStageTopics(stageId, incoming);
    } catch (err) {
      if (err instanceof StageTopicNotInTaskError) {
        return {
          ok: false,
          status: 409,
          error: 'STAGE_TOPIC_NOT_IN_TASK',
          meta: { missingTopicIds: err.missingTopicIds },
        };
      }
      throw err;
    }

    return { ok: true, data: { topicIds: incoming } };
  }

  private async validateTopics(
    topicIds: string[],
    taskStatus: Entities.Config.TaskStatus,
  ): Promise<ControllerResult<never> | null> {
    if (topicIds.length === 0) return null;

    const found = await Promise.all(topicIds.map(id => this.topics.findById(id)));
    const unknown = topicIds.filter((_, i) => found[i] === null);
    if (unknown.length > 0) {
      return {
        ok: false,
        status: 400,
        error: 'UNKNOWN_TOPIC_IDS',
        meta: { unknown },
      };
    }

    if (taskStatus === Entities.Config.TaskStatus.PUBLISHED) {
      const unpublished = found
        .filter((n): n is NonNullable<typeof n> => n !== null)
        .filter(n => n.status !== Entities.Config.TopicNodeStatus.PUBLISHED)
        .map(n => n.id);
      if (unpublished.length > 0) {
        return {
          ok: false,
          status: 409,
          error: 'LINKED_TOPIC_NOT_PUBLISHED',
          meta: { unpublished },
        };
      }
    }

    return null;
  }
}
