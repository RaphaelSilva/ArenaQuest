import { z } from 'zod';
import type {
  ITaskRepository,
  ITaskStageRepository,
  TaskStageRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '../core/result';
import { ValidateBody, Body } from '../core/decorators';

const LABEL_RE = /^[^\n\r]{1,120}$/;
const Label = z.string().trim().regex(LABEL_RE, 'Label must be 1-120 chars with no newlines');

export const CreateStageSchema = z.object({
  label: Label,
});

export const UpdateStageSchema = z.object({
  label: Label,
});

export const ReorderStagesSchema = z.object({
  stageIds: z.array(z.string()).min(1),
});

export class AdminTaskStagesController {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly stages: ITaskStageRepository,
  ) {}

  @ValidateBody(CreateStageSchema)
  async create(
    taskId: string,
    @Body() body: z.infer<typeof CreateStageSchema>,
  ): Promise<ControllerResult<TaskStageRecord>> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const stage = await this.stages.create({ taskId, label: body.label });
    return { ok: true, data: stage };
  }

  @ValidateBody(UpdateStageSchema)
  async update(
    taskId: string,
    stageId: string,
    @Body() body: z.infer<typeof UpdateStageSchema>,
  ): Promise<ControllerResult<TaskStageRecord>> {
    const ownership = await this.assertOwnership(taskId, stageId);
    if (ownership) return ownership;

    const updated = await this.stages.update(stageId, { label: body.label });
    return { ok: true, data: updated };
  }

  async delete(taskId: string, stageId: string): Promise<ControllerResult<null>> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const stage = await this.stages.findById(stageId);
    if (!stage || stage.taskId !== taskId) return { ok: false, status: 404, error: 'NotFound' };

    if (task.status === Entities.Config.TaskStatus.PUBLISHED) {
      return { ok: false, status: 409, error: 'STAGE_DELETE_FORBIDDEN' };
    }

    await this.stages.delete(stageId);
    return { ok: true, data: null };
  }

  @ValidateBody(ReorderStagesSchema)
  async reorder(
    taskId: string,
    @Body() body: z.infer<typeof ReorderStagesSchema>,
  ): Promise<ControllerResult<TaskStageRecord[]>> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const current = await this.stages.listByTask(taskId);
    const currentIds = new Set(current.map(s => s.id));
    const incoming = body.stageIds;

    if (incoming.length !== currentIds.size || incoming.some(id => !currentIds.has(id)) || new Set(incoming).size !== incoming.length) {
      return { ok: false, status: 409, error: 'STAGE_SET_MISMATCH' };
    }

    await this.stages.reorder(taskId, incoming);
    const next = await this.stages.listByTask(taskId);
    return { ok: true, data: next };
  }

  private async assertOwnership(taskId: string, stageId: string): Promise<ControllerResult<never> | null> {
    const task = await this.tasks.findById(taskId);
    if (!task) return { ok: false, status: 404, error: 'NotFound' };

    const stage = await this.stages.findById(stageId);
    if (!stage || stage.taskId !== taskId) return { ok: false, status: 404, error: 'NotFound' };
    return null;
  }
}
