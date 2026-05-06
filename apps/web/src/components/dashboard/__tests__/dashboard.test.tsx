import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardClient, ProgressRing } from '../dashboard-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({
    accessToken: 'test-token',
    user: { id: 'u1', name: 'João Silva', email: 'joao@test.com', roles: [], status: 'active', createdAt: '2025-01-01' },
    isLoading: false,
  }),
}));

const mockGetSummary = vi.fn();
const mockGetTopics = vi.fn();
const mockGetTasks = vi.fn();

vi.mock('@web/lib/progress-api', () => ({
  progressApi: {
    getSummary: (...a: unknown[]) => mockGetSummary(...a),
    getTopics: (...a: unknown[]) => mockGetTopics(...a),
    getTasks: (...a: unknown[]) => mockGetTasks(...a),
  },
}));

const mockListTopics = vi.fn();
vi.mock('@web/lib/topics-api', () => ({
  topicsApi: {
    list: (...a: unknown[]) => mockListTopics(...a),
  },
}));

const mockListTasks = vi.fn();
vi.mock('@web/lib/tasks-api', () => ({
  tasksApi: {
    list: (...a: unknown[]) => mockListTasks(...a),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUMMARY = {
  topics: { total: 10, completed: 4, inProgress: 2, percentage: 40 },
  tasks: { total: 5, completed: 2, inProgress: 1, percentage: 40 },
  lastActivityAt: '2026-05-01T10:00:00Z',
};

const TOPIC_NODES = [
  { id: 'root1', parentId: null, title: 'Fundamentos', status: 'published', content: '', archived: false, order: 0, estimatedMinutes: 30, tags: [], prerequisiteIds: [] },
  { id: 'child1', parentId: 'root1', title: 'Subtópico 1', status: 'published', content: '', archived: false, order: 0, estimatedMinutes: 10, tags: [], prerequisiteIds: [] },
];

const TOPIC_PROGRESS = [
  { topicNodeId: 'root1', status: 'in_progress', completedAt: null, updatedAt: '2026-05-01T10:00:00Z' },
  { topicNodeId: 'child1', status: 'completed', completedAt: '2026-05-01T09:00:00Z', updatedAt: '2026-05-01T09:00:00Z' },
];

const TASK_LIST = [
  { id: 'task1', title: 'Passe de bola', stageCount: 3, topicCount: 2, updatedAt: '2026-05-01T00:00:00Z' },
  { id: 'task2', title: 'Recepção', stageCount: 2, topicCount: 1, updatedAt: '2026-05-01T00:00:00Z' },
];

const TASK_PROGRESS_ITEMS = [
  { taskId: 'task1', status: 'in_progress', currentStageId: 's2', completedAt: null, updatedAt: '2026-05-01T10:00:00Z' },
  { taskId: 'task2', status: 'completed', currentStageId: null, completedAt: '2026-05-01T12:00:00Z', updatedAt: '2026-05-01T12:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
  mockGetSummary.mockResolvedValue(SUMMARY);
  mockGetTopics.mockResolvedValue(TOPIC_PROGRESS);
  mockGetTasks.mockResolvedValue(TASK_PROGRESS_ITEMS);
  mockListTopics.mockResolvedValue(TOPIC_NODES);
  mockListTasks.mockResolvedValue(TASK_LIST);
});

// ---------------------------------------------------------------------------
// ProgressRing unit tests
// ---------------------------------------------------------------------------

describe('ProgressRing', () => {
  it('renders the percentage as accessible text', () => {
    render(<ProgressRing percentage={75} color="green" label="Tópicos" />);
    expect(screen.getByRole('img', { name: /Tópicos: 75%/i })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('caps percentage at 100', () => {
    render(<ProgressRing percentage={150} color="green" label="Tópicos" />);
    expect(screen.getByRole('img', { name: /100%/i })).toBeInTheDocument();
  });

  it('floors negative percentage to 0', () => {
    render(<ProgressRing percentage={-10} color="green" label="Tópicos" />);
    expect(screen.getByRole('img', { name: /0%/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DashboardClient — summary card rendering
// ---------------------------------------------------------------------------

describe('DashboardClient — summary cards', () => {
  it('renders topic completion percentage from API', async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByLabelText(/40% de tópicos concluídos/i)).toBeInTheDocument());
  });

  it('renders task completion percentage from API', async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByLabelText(/40% de missões concluídas/i)).toBeInTheDocument());
  });

  it('renders last activity date', async () => {
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByLabelText(/última atividade/i)).toBeInTheDocument());
  });

  it('renders progress bars with correct ARIA attributes', async () => {
    render(<DashboardClient />);
    await waitFor(() => {
      const bars = screen.getAllByRole('progressbar');
      expect(bars.length).toBeGreaterThanOrEqual(2);
      const topicsBar = bars.find((b) => b.getAttribute('aria-label')?.toLowerCase().includes('tópicos'));
      expect(topicsBar).toHaveAttribute('aria-valuenow', '40');
    });
  });
});

// ---------------------------------------------------------------------------
// DashboardClient — continue list
// ---------------------------------------------------------------------------

describe('DashboardClient — continue list', () => {
  it('renders in-progress task with a link to the task page', async () => {
    render(<DashboardClient />);
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /passe de bola/i });
      expect(link).toHaveAttribute('href', '/tasks/task1');
    });
  });

  it('does not render completed tasks in the continue list', async () => {
    render(<DashboardClient />);
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /recepção/i })).toBeNull();
    });
  });

  it('shows empty state when no in-progress tasks', async () => {
    mockGetTasks.mockResolvedValue([]);
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByText(/Nenhuma missão em andamento/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// DashboardClient — topic breakdown (rollup)
// ---------------------------------------------------------------------------

describe('DashboardClient — topic breakdown', () => {
  it('renders root topic title in the breakdown', async () => {
    render(<DashboardClient />);
    await waitFor(() => {
      expect(screen.getByText('Fundamentos')).toBeInTheDocument();
    });
  });

  it('shows empty state when no topics are assigned', async () => {
    mockListTopics.mockResolvedValue([]);
    mockGetTopics.mockResolvedValue([]);
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByText(/Nenhum tópico atribuído/i)).toBeInTheDocument());
  });

  it('includes completed/total counts for each rollup', async () => {
    render(<DashboardClient />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 2 concluídos/)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// DashboardClient — error handling
// ---------------------------------------------------------------------------

describe('DashboardClient — error state', () => {
  it('shows error alert when API call fails', async () => {
    mockGetSummary.mockRejectedValue(new Error('Network error'));
    render(<DashboardClient />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// DashboardClient — SWR / cache
// ---------------------------------------------------------------------------

describe('DashboardClient — stale-while-revalidate cache', () => {
  it('shows cached data from localStorage before fetch completes', async () => {
    const cachedData = {
      summary: {
        topics: { total: 5, completed: 5, inProgress: 0, percentage: 100 },
        tasks: { total: 3, completed: 3, inProgress: 0, percentage: 100 },
        lastActivityAt: '2026-04-01T00:00:00Z',
      },
      rollups: [],
      inProgressTasks: [],
    };
    localStorageMock.setItem('aq_dashboard_v1', JSON.stringify(cachedData));

    // Delay the fresh fetch so stale data is visible first
    mockGetSummary.mockReturnValue(new Promise(() => {}));

    render(<DashboardClient />);
    await waitFor(() => {
      expect(screen.getByLabelText(/100% de tópicos concluídos/i)).toBeInTheDocument();
    });
  });
});
