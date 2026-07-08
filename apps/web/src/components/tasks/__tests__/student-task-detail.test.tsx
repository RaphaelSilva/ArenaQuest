import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { StudentTaskDetail } from '../student-task-detail';
import type { PublicTaskDetail } from '@web/lib/tasks-api';

const mockCheckIn = vi.fn();

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      tasks: {
        checkIn: (...args: unknown[]) => mockCheckIn(...args),
      },
    }),
  };
});

function makeTask(overrides: Partial<PublicTaskDetail> = {}): PublicTaskDetail {
  return {
    id: 't1',
    title: 'Passe de bola',
    description: 'Descrição da missão',
    updatedAt: '2026-05-01T00:00:00Z',
    stages: [
      { id: 's1', label: 'Aquecimento', order: 0, topics: [{ id: 'top1', title: 'Fundamentos' }] },
      { id: 's2', label: 'Prática', order: 1, topics: [] },
      { id: 's3', label: 'Revisão', order: 2, topics: [] },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StudentTaskDetail — stage state rendering', () => {
  it('marks the first stage as current and renders its check-in button', () => {
    render(<StudentTaskDetail task={makeTask()} />);
    const btn = screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('marks subsequent stages as locked', () => {
    render(<StudentTaskDetail task={makeTask()} />);
    const locked = screen.getAllByText(dictPt.tasks.detail.locked);
    expect(locked).toHaveLength(2);
  });

  it('marks pre-checked stages as completed with strikethrough label', () => {
    const checkins = [{ stageId: 's1', checkedInAt: '2026-05-01T10:00:00Z' }];
    render(<StudentTaskDetail task={makeTask()} initialCheckins={checkins} />);
    const label = screen.getByText('Aquecimento');
    expect(label).toHaveStyle({ textDecoration: 'line-through' });
  });

  it('shows all-done banner when all stages are checked', () => {
    const checkins = [
      { stageId: 's1', checkedInAt: '2026-05-01T10:00:00Z' },
      { stageId: 's2', checkedInAt: '2026-05-01T11:00:00Z' },
      { stageId: 's3', checkedInAt: '2026-05-01T12:00:00Z' },
    ];
    render(<StudentTaskDetail task={makeTask()} initialCheckins={checkins} />);
    expect(screen.getByText(dictPt.tasks.detail.completedLabel)).toBeInTheDocument();
  });

  it('shows empty state when task has no stages', () => {
    render(<StudentTaskDetail task={makeTask({ stages: [] })} />);
    expect(screen.getByText(dictPt.tasks.detail.noStages)).toBeInTheDocument();
  });

  it('renders topic chips as catalog links', () => {
    render(<StudentTaskDetail task={makeTask()} />);
    const chip = screen.getByRole('link', { name: 'Fundamentos' });
    expect(chip).toHaveAttribute('href', '/catalog/top1');
  });
});

describe('StudentTaskDetail — check-in flow', () => {
  it('disables button while request is in-flight', async () => {
    mockCheckIn.mockReturnValue(new Promise(() => {}));
    render(<StudentTaskDetail task={makeTask()} />);
    const btn = screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    expect(screen.getByText(dictPt.tasks.detail.checkInLoading)).toBeInTheDocument();
  });

  it('advances stage state after successful check-in', async () => {
    mockCheckIn.mockResolvedValueOnce({
      result: {
        checkIn: { id: 'ci1', stageId: 's1', checkedInAt: '2026-05-02T08:00:00Z' },
        taskProgress: { status: 'in_progress', currentStageId: 's2', completedAt: null },
      },
      created: true,
    });
    render(<StudentTaskDetail task={makeTask()} />);
    fireEvent.click(screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Prática') })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') })).toBeNull();
  });

  it('ignores double-click while inflight (only one request)', async () => {
    let resolve!: (v: unknown) => void;
    mockCheckIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<StudentTaskDetail task={makeTask()} />);
    const btn = screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    resolve({
      result: { checkIn: { id: 'ci1', stageId: 's1', checkedInAt: '2026-05-02T08:00:00Z' }, taskProgress: {} },
      created: true,
    });
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
  });
});

describe('StudentTaskDetail — error toasts', () => {
  it('shows OUT_OF_ORDER toast with expected stage name', async () => {
    mockCheckIn.mockResolvedValueOnce({
      error: { type: 'OUT_OF_ORDER', expectedStageId: 's1' },
    });
    render(<StudentTaskDetail task={makeTask()} initialCheckins={[]} />);
    fireEvent.click(screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Aquecimento/),
    );
  });

  it('shows generic error toast for UNKNOWN errors', async () => {
    mockCheckIn.mockResolvedValueOnce({
      error: { type: 'UNKNOWN', message: 'server error' },
    });
    render(<StudentTaskDetail task={makeTask()} />);
    fireEvent.click(screen.getByRole('button', { name: dictPt.tasks.detail.checkInAriaLabel('Aquecimento') }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(dictPt.tasks.detail.errorGeneral),
    );
  });
});
