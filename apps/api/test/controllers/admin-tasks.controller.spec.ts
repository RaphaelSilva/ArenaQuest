import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTasksController } from '@api/controllers/admin-tasks.controller';
import type {
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  ITopicNodeRepository,
  TaskRecord,
  TaskStageRecord,
  TopicNodeRecord,
  TaskLinkHydration,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

const USER_ID = 'user-1';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    title: 'T',
    description: '',
    status: Entities.Config.TaskStatus.DRAFT,
    createdBy: USER_ID,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTopic(id: string, status: Entities.Config.TopicNodeStatus): TopicNodeRecord {
  return {
    id,
    parentId: null,
    title: id,
    content: '',
    status,
    tags: [],
    order: 0,
    estimatedMinutes: 0,
    prerequisiteIds: [],
    archived: status === Entities.Config.TopicNodeStatus.ARCHIVED,
  };
}

function makeRepos(initial: TaskRecord[] = []) {
  const taskStore = new Map<string, TaskRecord>(initial.map(t => [t.id, t]));
  const stageStore = new Map<string, TaskStageRecord[]>();
  const taskTopics = new Map<string, string[]>();
  const topicStore = new Map<string, TopicNodeRecord>();

  const tasks: ITaskRepository = {
    findById: vi.fn(async (id) => taskStore.get(id) ?? null),
    list: vi.fn(async () => [...taskStore.values()]),
    create: vi.fn(async (data) => {
      const t = makeTask({ id: `new-${taskStore.size + 1}`, title: data.title, description: data.description ?? '', createdBy: data.createdBy });
      taskStore.set(t.id, t);
      return t;
    }),
    update: vi.fn(async (id, patch) => {
      const cur = taskStore.get(id);
      if (!cur) throw new Error('not found');
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      taskStore.set(id, next);
      return next;
    }),
    delete: vi.fn(async (id) => { taskStore.delete(id); }),
  };

  const stages: ITaskStageRepository = {
    findById: vi.fn(async () => null),
    listByTask: vi.fn(async (id) => stageStore.get(id) ?? []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  };

  const links: ITaskLinkingRepository = {
    setTaskTopics: vi.fn(),
    listTaskTopics: vi.fn(async (id) => taskTopics.get(id) ?? []),
    setStageTopics: vi.fn(),
    listStageTopics: vi.fn(async () => []),
    hydrate: vi.fn(async (id): Promise<TaskLinkHydration> => ({
      taskTopicIds: taskTopics.get(id) ?? [],
      stages: [],
    })),
  };

  const topics: Partial<ITopicNodeRepository> = {
    findById: vi.fn(async (id) => topicStore.get(id) ?? null),
  };

  return {
    tasks, stages, links,
    topics: topics as ITopicNodeRepository,
    setStages: (taskId: string, list: TaskStageRecord[]) => stageStore.set(taskId, list),
    setTaskTopics: (taskId: string, ids: string[]) => taskTopics.set(taskId, ids),
    addTopic: (t: TopicNodeRecord) => topicStore.set(t.id, t),
    taskStore,
  };
}

describe('AdminTasksController', () => {
  let h: ReturnType<typeof makeRepos>;
  let controller: AdminTasksController;

  beforeEach(() => {
    h = makeRepos();
    controller = new AdminTasksController(h.tasks, h.stages, h.links, h.topics);
  });

  it('create - sanitizes description and persists', async () => {
    const result = await controller.create(
      { title: 'New', description: '<script>alert(1)</script>Hello' },
      USER_ID,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.description).not.toContain('<script>');
    expect(result.data.description).toContain('Hello');
  });

  it('create - rejects title over 200 chars', async () => {
    const result = await controller.create({ title: 'x'.repeat(201) }, USER_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  it('getById - 404 when missing', async () => {
    const result = await controller.getById('nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it('update - publish blocked when no stages', async () => {
    const draft = makeTask({ id: 'd1' });
    h.taskStore.set('d1', draft);
    const result = await controller.update('d1', { status: 'published' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe('TASK_NOT_PUBLISHABLE');
    expect((result.meta as { reasons: string[] }).reasons).toContain('NO_STAGES');
  });

  it('update - publish blocked when linked topic not published', async () => {
    const draft = makeTask({ id: 'd2' });
    h.taskStore.set('d2', draft);
    h.setStages('d2', [{ id: 's1', taskId: 'd2', label: 'L', order: 0, createdAt: '' }]);
    h.setTaskTopics('d2', ['t1']);
    h.addTopic(makeTopic('t1', Entities.Config.TopicNodeStatus.DRAFT));

    const result = await controller.update('d2', { status: 'published' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.meta as { reasons: string[] }).reasons).toContain('LINKED_TOPIC_NOT_PUBLISHED');
  });

  it('update - publish succeeds when stages exist and topics published', async () => {
    const draft = makeTask({ id: 'd3' });
    h.taskStore.set('d3', draft);
    h.setStages('d3', [{ id: 's1', taskId: 'd3', label: 'L', order: 0, createdAt: '' }]);
    h.setTaskTopics('d3', ['t1']);
    h.addTopic(makeTopic('t1', Entities.Config.TopicNodeStatus.PUBLISHED));

    const result = await controller.update('d3', { status: 'published' });
    expect(result.ok).toBe(true);
  });

  it('update - archived -> published is forbidden', async () => {
    h.taskStore.set('arc', makeTask({ id: 'arc', status: Entities.Config.TaskStatus.ARCHIVED }));
    const result = await controller.update('arc', { status: 'published' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('INVALID_TRANSITION');
  });

  it('update - archived -> draft is allowed', async () => {
    h.taskStore.set('arc', makeTask({ id: 'arc', status: Entities.Config.TaskStatus.ARCHIVED }));
    const result = await controller.update('arc', { status: 'draft' });
    expect(result.ok).toBe(true);
  });

  it('archive - sets status to archived', async () => {
    h.taskStore.set('p', makeTask({ id: 'p', status: Entities.Config.TaskStatus.PUBLISHED }));
    const result = await controller.archive('p');
    expect(result.ok).toBe(true);
    expect(h.taskStore.get('p')?.status).toBe(Entities.Config.TaskStatus.ARCHIVED);
  });
});
