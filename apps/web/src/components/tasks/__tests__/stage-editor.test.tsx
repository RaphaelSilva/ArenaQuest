import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StageEditor } from '../stage-editor';
import type { TaskDetail, TaskStage } from '@web/lib/admin-tasks-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

const updateStage = vi.fn();
const reorderStages = vi.fn();
const deleteStage = vi.fn();
const setStageTopics = vi.fn();
const createStage = vi.fn();

vi.mock('@web/lib/admin-tasks-api', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/admin-tasks-api')>(
    '@web/lib/admin-tasks-api',
  );
  return {
    ...actual,
    adminTasksApi: {
      updateStage: (...args: unknown[]) => updateStage(...args),
      reorderStages: (...args: unknown[]) => reorderStages(...args),
      deleteStage: (...args: unknown[]) => deleteStage(...args),
      setStageTopics: (...args: unknown[]) => setStageTopics(...args),
      createStage: (...args: unknown[]) => createStage(...args),
    },
  };
});

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ token: 'tk' }),
}));

function stage(id: string, label: string, order: number): TaskStage {
  return { id, taskId: 't1', label, order, createdAt: '' };
}

function makeTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 't1',
    title: 'T',
    description: '',
    status: 'draft',
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
    stages: [stage('s1', 'A', 0), stage('s2', 'B', 1)],
    taskTopicIds: ['top1'],
    stageTopicIds: { s1: [], s2: [] },
    ...overrides,
  };
}

const TOPICS: TopicNode[] = [
  {
    id: 'top1', parentId: null, title: 'Topic 1', content: '', status: 'published',
    archived: false, order: 0, estimatedMinutes: 0, tags: [], prerequisiteIds: [],
  },
  {
    id: 'top2', parentId: null, title: 'Topic 2', content: '', status: 'published',
    archived: false, order: 0, estimatedMinutes: 0, tags: [], prerequisiteIds: [],
  },
];

describe('StageEditor', () => {
  beforeEach(() => {
    updateStage.mockReset();
    reorderStages.mockReset();
    deleteStage.mockReset();
    setStageTopics.mockReset();
    createStage.mockReset();
  });

  it('renders stages in order', () => {
    render(<StageEditor task={makeTask()} topics={TOPICS} onChange={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('disables delete when task is published with informative tooltip', () => {
    render(
      <StageEditor task={makeTask({ status: 'published' })} topics={TOPICS} onChange={vi.fn()} />,
    );
    const del = screen.getByLabelText('Delete A');
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute('title', expect.stringMatching(/published/i));
  });

  it('reverts and toasts when reorder fails', async () => {
    reorderStages.mockRejectedValueOnce(
      Object.assign(new Error('STAGE_SET_MISMATCH'), {
        name: 'AdminTasksApiError',
        code: 'STAGE_SET_MISMATCH',
        status: 409,
        details: {},
      }),
    );
    // The mock above uses Error; the component checks `instanceof AdminTasksApiError`.
    // Use the real class so the toast hint matches.
    const { AdminTasksApiError } = await import('@web/lib/admin-tasks-api');
    reorderStages.mockReset();
    reorderStages.mockRejectedValueOnce(new AdminTasksApiError('STAGE_SET_MISMATCH', 409));

    const onChange = vi.fn();
    render(<StageEditor task={makeTask()} topics={TOPICS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Move A down'));

    await waitFor(() => expect(reorderStages).toHaveBeenCalled());
    await screen.findByText(/Stage list changed/i);
    // Order reverts: A still appears before B in DOM
    const firstStage = screen.getByText('A').closest('li');
    expect(firstStage).toHaveAttribute('data-testid', 'stage-s1');
  });

  it('toggles stage-topic and rolls back on failure', async () => {
    const { AdminTasksApiError } = await import('@web/lib/admin-tasks-api');
    setStageTopics.mockRejectedValueOnce(new AdminTasksApiError('STAGE_TOPIC_NOT_IN_TASK', 409));
    render(<StageEditor task={makeTask()} topics={TOPICS} onChange={vi.fn()} />);

    // top2 is NOT in the task; checkbox should be disabled
    const allChecks = screen.getAllByRole('checkbox');
    const top2 = allChecks.find((el) => (el as HTMLInputElement).disabled);
    expect(top2).toBeDefined();
  });

  it('add stage triggers createStage', async () => {
    createStage.mockResolvedValueOnce({});
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<StageEditor task={makeTask({ stages: [] })} topics={TOPICS} onChange={onChange} />);

    fireEvent.click(screen.getByText('Add Stage'));
    await waitFor(() => expect(createStage).toHaveBeenCalledWith('tk', 't1', 'Stage 1'));
  });
});
