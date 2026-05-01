import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicTasksController } from '@api/controllers/public-tasks.controller';
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

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 't', title: 'T', description: '',
    status: Entities.Config.TaskStatus.PUBLISHED,
    createdBy: 'u', createdAt: '', updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeTopic(id: string, status = Entities.Config.TopicNodeStatus.PUBLISHED): TopicNodeRecord {
  return {
    id, parentId: null, title: `title-${id}`, content: '', status,
    tags: [], order: 0, estimatedMinutes: 0, prerequisiteIds: [],
    archived: false,
  };
}

function makeRepos() {
  const taskStore = new Map<string, TaskRecord>();
  const stageStore = new Map<string, TaskStageRecord[]>();
  const taskTopics = new Map<string, string[]>();
  const stageTopics = new Map<string, string[]>();
  const topicStore = new Map<string, TopicNodeRecord>();

  const tasks: ITaskRepository = {
    findById: vi.fn(async (id) => taskStore.get(id) ?? null),
    list: vi.fn(async (opts) => {
      let list = [...taskStore.values()];
      if (opts?.status) list = list.filter(t => t.status === opts.status);
      return list;
    }),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  const stages: ITaskStageRepository = {
    findById: vi.fn(),
    listByTask: vi.fn(async (id) => stageStore.get(id) ?? []),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), reorder: vi.fn(),
  };
  const links: ITaskLinkingRepository = {
    setTaskTopics: vi.fn(),
    listTaskTopics: vi.fn(async (id) => taskTopics.get(id) ?? []),
    setStageTopics: vi.fn(),
    listStageTopics: vi.fn(async (id) => stageTopics.get(id) ?? []),
    hydrate: vi.fn(async (taskId): Promise<TaskLinkHydration> => ({
      taskTopicIds: taskTopics.get(taskId) ?? [],
      stages: (stageStore.get(taskId) ?? []).map(s => ({
        stageId: s.id,
        topicIds: stageTopics.get(s.id) ?? [],
      })),
    })),
  };
  const topics = {
    findById: vi.fn(async (id: string) => topicStore.get(id) ?? null),
  } as unknown as ITopicNodeRepository;

  return { tasks, stages, links, topics, taskStore, stageStore, taskTopics, stageTopics, topicStore };
}

describe('PublicTasksController', () => {
  let h: ReturnType<typeof makeRepos>;
  let controller: PublicTasksController;

  beforeEach(() => {
    h = makeRepos();
    controller = new PublicTasksController(h.tasks, h.stages, h.links, h.topics);
  });

  it('list - returns only published tasks with summary counts', async () => {
    const pub = makeTask({ id: 'p1' });
    h.taskStore.set('p1', pub);
    h.stageStore.set('p1', [
      { id: 's1', taskId: 'p1', label: 'A', order: 0, createdAt: '' },
      { id: 's2', taskId: 'p1', label: 'B', order: 1, createdAt: '' },
    ]);
    h.taskTopics.set('p1', ['t1', 't2', 't3']);

    const r = await controller.list({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ id: 'p1', stageCount: 2, topicCount: 3 });
  });

  it('getById - 404 for draft task', async () => {
    h.taskStore.set('d', makeTask({ id: 'd', status: Entities.Config.TaskStatus.DRAFT }));
    const r = await controller.getById('d');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('getById - hydrates stages with published topics only', async () => {
    h.taskStore.set('p', makeTask({ id: 'p', description: 'Body' }));
    h.stageStore.set('p', [{ id: 's1', taskId: 'p', label: 'L', order: 0, createdAt: '' }]);
    h.stageTopics.set('s1', ['ok', 'archived']);
    h.topicStore.set('ok', makeTopic('ok'));
    h.topicStore.set('archived', makeTopic('archived', Entities.Config.TopicNodeStatus.ARCHIVED));

    const r = await controller.getById('p');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.stages).toHaveLength(1);
    expect(r.data.stages[0].topics.map(t => t.id)).toEqual(['ok']);
    expect(r.data.description).toBe('Body');
  });

  it('list - clamps limit to max 200', async () => {
    h.taskStore.set('p1', makeTask({ id: 'p1' }));
    const listSpy = h.tasks.list as ReturnType<typeof vi.fn>;
    await controller.list({ limit: 9999 });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });
});
