import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminTaskLinkingController } from '@api/controllers/admin-task-linking.controller';
import {
  type ITaskRepository,
  type ITaskStageRepository,
  type ITaskLinkingRepository,
  type ITopicNodeRepository,
  type TaskRecord,
  type TaskStageRecord,
  type TopicNodeRecord,
  StageTopicNotInTaskError,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1', title: 'T', description: '',
    status: Entities.Config.TaskStatus.DRAFT,
    createdBy: 'u', createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function makeTopic(id: string, status = Entities.Config.TopicNodeStatus.PUBLISHED): TopicNodeRecord {
  return {
    id, parentId: null, title: id, content: '', status,
    tags: [], order: 0, estimatedMinutes: 0, prerequisiteIds: [],
    archived: false,
  };
}

function makeRepos() {
  const taskStore = new Map<string, TaskRecord>();
  const stageStore = new Map<string, TaskStageRecord>();
  const topicStore = new Map<string, TopicNodeRecord>();
  const taskLinks = new Map<string, string[]>();
  const stageLinks = new Map<string, string[]>();

  const tasks: ITaskRepository = {
    findById: vi.fn(async (id) => taskStore.get(id) ?? null),
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  const stages: ITaskStageRepository = {
    findById: vi.fn(async (id) => stageStore.get(id) ?? null),
    listByTask: vi.fn(async (taskId) => [...stageStore.values()].filter(s => s.taskId === taskId)),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), reorder: vi.fn(),
  };
  const topics = {
    findById: vi.fn(async (id: string) => topicStore.get(id) ?? null),
  } as unknown as ITopicNodeRepository;
  const links: ITaskLinkingRepository = {
    setTaskTopics: vi.fn(async (taskId, ids) => { taskLinks.set(taskId, [...ids]); }),
    listTaskTopics: vi.fn(async (taskId) => taskLinks.get(taskId) ?? []),
    setStageTopics: vi.fn(async (stageId, ids) => {
      const stage = stageStore.get(stageId)!;
      const taskTopics = new Set(taskLinks.get(stage.taskId) ?? []);
      const missing = ids.filter(id => !taskTopics.has(id));
      if (missing.length > 0) throw new StageTopicNotInTaskError(stageId, missing);
      stageLinks.set(stageId, [...ids]);
    }),
    listStageTopics: vi.fn(async (stageId) => stageLinks.get(stageId) ?? []),
    hydrate: vi.fn(),
  };
  return { tasks, stages, topics, links, taskStore, stageStore, topicStore, taskLinks, stageLinks };
}

describe('AdminTaskLinkingController', () => {
  let h: ReturnType<typeof makeRepos>;
  let controller: AdminTaskLinkingController;

  beforeEach(() => {
    h = makeRepos();
    controller = new AdminTaskLinkingController(h.tasks, h.stages, h.links, h.topics);
  });

  it('replaceTaskTopics - rejects unknown topic ids', async () => {
    h.taskStore.set('t1', makeTask());
    h.topicStore.set('a', makeTopic('a'));
    const r = await controller.replaceTaskTopics('t1', { topicIds: ['a', 'ghost'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('UNKNOWN_TOPIC_IDS');
  });

  it('replaceTaskTopics - draft task can link draft topics', async () => {
    h.taskStore.set('t1', makeTask());
    h.topicStore.set('d', makeTopic('d', Entities.Config.TopicNodeStatus.DRAFT));
    const r = await controller.replaceTaskTopics('t1', { topicIds: ['d'] });
    expect(r.ok).toBe(true);
  });

  it('replaceTaskTopics - published task rejects unpublished topic', async () => {
    h.taskStore.set('t1', makeTask({ status: Entities.Config.TaskStatus.PUBLISHED }));
    h.topicStore.set('d', makeTopic('d', Entities.Config.TopicNodeStatus.DRAFT));
    const r = await controller.replaceTaskTopics('t1', { topicIds: ['d'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('LINKED_TOPIC_NOT_PUBLISHED');
  });

  it('replaceTaskTopics - cascade-shrink prunes stage links', async () => {
    h.taskStore.set('t1', makeTask());
    h.topicStore.set('a', makeTopic('a'));
    h.topicStore.set('b', makeTopic('b'));
    h.stageStore.set('s1', { id: 's1', taskId: 't1', label: 'S', order: 0, createdAt: '' });
    h.taskLinks.set('t1', ['a', 'b']);
    h.stageLinks.set('s1', ['a', 'b']);

    const r = await controller.replaceTaskTopics('t1', { topicIds: ['a'] });
    expect(r.ok).toBe(true);
    expect(h.stageLinks.get('s1')).toEqual(['a']);
  });

  it('replaceStageTopics - rejects topics outside task set', async () => {
    h.taskStore.set('t1', makeTask());
    h.stageStore.set('s1', { id: 's1', taskId: 't1', label: 'S', order: 0, createdAt: '' });
    h.topicStore.set('a', makeTopic('a'));
    h.topicStore.set('b', makeTopic('b'));
    h.taskLinks.set('t1', ['a']);

    const r = await controller.replaceStageTopics('t1', 's1', { topicIds: ['a', 'b'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('STAGE_TOPIC_NOT_IN_TASK');
  });

  it('replaceStageTopics - succeeds for subset', async () => {
    h.taskStore.set('t1', makeTask());
    h.stageStore.set('s1', { id: 's1', taskId: 't1', label: 'S', order: 0, createdAt: '' });
    h.topicStore.set('a', makeTopic('a'));
    h.taskLinks.set('t1', ['a']);

    const r = await controller.replaceStageTopics('t1', 's1', { topicIds: ['a'] });
    expect(r.ok).toBe(true);
    expect(h.stageLinks.get('s1')).toEqual(['a']);
  });
});
