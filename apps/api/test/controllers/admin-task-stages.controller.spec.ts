import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTaskStagesController } from '@api/controllers/admin-task-stages.controller';
import type {
  ITaskRepository,
  ITaskStageRepository,
  TaskRecord,
  TaskStageRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    title: 'T',
    description: '',
    status: Entities.Config.TaskStatus.DRAFT,
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeStage(id: string, taskId: string, order: number, label = 'L'): TaskStageRecord {
  return { id, taskId, label, order, createdAt: '' };
}

function makeRepos() {
  const taskStore = new Map<string, TaskRecord>();
  const stageStore = new Map<string, TaskStageRecord>();
  const tasks: ITaskRepository = {
    findById: vi.fn(async (id) => taskStore.get(id) ?? null),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const stages: ITaskStageRepository = {
    findById: vi.fn(async (id) => stageStore.get(id) ?? null),
    listByTask: vi.fn(async (taskId) =>
      [...stageStore.values()].filter(s => s.taskId === taskId).sort((a, b) => a.order - b.order),
    ),
    create: vi.fn(async (data) => {
      const list = [...stageStore.values()].filter(s => s.taskId === data.taskId);
      const order = list.length;
      const stage = makeStage(`s-${stageStore.size + 1}`, data.taskId, order, data.label);
      stageStore.set(stage.id, stage);
      return stage;
    }),
    update: vi.fn(async (id, patch) => {
      const cur = stageStore.get(id)!;
      const next = { ...cur, ...patch };
      stageStore.set(id, next);
      return next;
    }),
    delete: vi.fn(async (id) => { stageStore.delete(id); }),
    reorder: vi.fn(async (taskId, ids) => {
      ids.forEach((id, i) => {
        const cur = stageStore.get(id)!;
        stageStore.set(id, { ...cur, order: i });
      });
      void taskId;
    }),
  };
  return { tasks, stages, taskStore, stageStore };
}

describe('AdminTaskStagesController', () => {
  let h: ReturnType<typeof makeRepos>;
  let controller: AdminTaskStagesController;

  beforeEach(() => {
    h = makeRepos();
    controller = new AdminTaskStagesController(h.tasks, h.stages);
  });

  it('create - appends a stage with auto-order', async () => {
    h.taskStore.set('t1', makeTask({ id: 't1' }));
    const r1 = await controller.create('t1', { label: 'Reading' });
    const r2 = await controller.create('t1', { label: 'Practice' });
    expect(r1.ok && r1.data.order).toBe(0);
    expect(r2.ok && r2.data.order).toBe(1);
  });

  it('create - 404 when task does not exist', async () => {
    const r = await controller.create('nope', { label: 'X' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('create - rejects label with newlines', async () => {
    h.taskStore.set('t', makeTask({ id: 't' }));
    const r = await controller.create('t', { label: 'a\nb' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it('update - 404 when stage does not belong to task', async () => {
    h.taskStore.set('t1', makeTask({ id: 't1' }));
    h.taskStore.set('t2', makeTask({ id: 't2' }));
    h.stageStore.set('s1', makeStage('s1', 't1', 0));
    const r = await controller.update('t2', 's1', { label: 'X' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('delete - forbidden when parent is published', async () => {
    h.taskStore.set('t', makeTask({ id: 't', status: Entities.Config.TaskStatus.PUBLISHED }));
    h.stageStore.set('s1', makeStage('s1', 't', 0));
    const r = await controller.delete('t', 's1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.error).toBe('STAGE_DELETE_FORBIDDEN');
  });

  it('delete - succeeds on draft parent', async () => {
    h.taskStore.set('t', makeTask({ id: 't' }));
    h.stageStore.set('s1', makeStage('s1', 't', 0));
    const r = await controller.delete('t', 's1');
    expect(r.ok).toBe(true);
    expect(h.stageStore.has('s1')).toBe(false);
  });

  it('reorder - mismatched set returns 409', async () => {
    h.taskStore.set('t', makeTask({ id: 't' }));
    h.stageStore.set('a', makeStage('a', 't', 0));
    h.stageStore.set('b', makeStage('b', 't', 1));
    const r = await controller.reorder('t', { stageIds: ['a'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('STAGE_SET_MISMATCH');
  });

  it('reorder - applies new order', async () => {
    h.taskStore.set('t', makeTask({ id: 't' }));
    h.stageStore.set('a', makeStage('a', 't', 0));
    h.stageStore.set('b', makeStage('b', 't', 1));
    h.stageStore.set('c', makeStage('c', 't', 2));
    const r = await controller.reorder('t', { stageIds: ['c', 'a', 'b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });
});
