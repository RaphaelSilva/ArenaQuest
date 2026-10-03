import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type {
  Mission,
  MissionParticipant,
  MissionParticipantPage,
  MissionRequirement,
} from '@web/lib/admin-gamification-api';
import { ParticipantsPanel } from '../ParticipantsPanel';
import { deriveStepChips } from '../participant-chips';

const d = dictEn.admin.missions.participants;

const MISSION = '99999999-9999-4999-8999-999999999999';
const TOPIC = '11111111-1111-4111-8111-111111111111';
const REQ_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const api = { listParticipants: vi.fn(), reconcile: vi.fn() };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  const client = {
    adminGamification: {
      missions: {
        listParticipants: (...a: unknown[]) => api.listParticipants(...a),
        reconcile: (...a: unknown[]) => api.reconcile(...a),
      },
    },
  };
  return { ...actual, useApiClient: () => client };
});

const mission = (mode: Mission['mode'] = 'sequential'): Mission => ({
  id: MISSION,
  title: 'Kihon month',
  description: 'Demonstrate, then check.',
  startAt: '2026-10-01T00:00:00.000Z',
  endAt: '2026-10-31T00:00:00.000Z',
  xpReward: 300,
  badgeId: null,
  active: true,
  mode,
  enrollmentMode: 'auto',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const requirement = (id: string, position: number, title: string, extra: Partial<MissionRequirement>): MissionRequirement => ({
  id,
  missionId: MISSION,
  position,
  kind: 'manual_check',
  title,
  topicId: null,
  eventId: null,
  params: { instructions: 'Bow.' },
  xpReward: 10,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const REQUIREMENTS: MissionRequirement[] = [
  requirement(REQ_1, 1, 'Three demonstrations', {
    kind: 'submissions_on_topic',
    topicId: TOPIC,
    params: { minCount: 3, requireDescription: false, visibility: 'any', countModerated: false },
  }),
  requirement(REQ_2, 2, 'Self-check', {}),
  requirement(REQ_3, 3, 'Watch the kata', { kind: 'video_watched', topicId: TOPIC, params: { minCount: 2 } }),
];

const participant = (userId: string, overrides: Partial<MissionParticipant> = {}): MissionParticipant => ({
  userId,
  name: `Student ${userId}`,
  email: `${userId}@example.com`,
  source: 'auto',
  joinedAt: '2026-10-02 08:00:00',
  countsFrom: '2026-10-01T00:00:00.000Z',
  leftAt: null,
  progress: { currentValue: 0, targetValue: 3, completed: false, completedAt: null },
  steps: [],
  ...overrides,
});

const page = (data: MissionParticipant[], nextCursor: string | null = null): MissionParticipantPage => ({ data, nextCursor });

function renderPanel(props: { canReconcile?: boolean; mode?: Mission['mode'] } = {}) {
  return render(
    <DictProvider value={dictEn}>
      <ParticipantsPanel
        missionId={MISSION}
        mission={mission(props.mode)}
        requirements={REQUIREMENTS}
        canReconcile={props.canReconcile ?? true}
      />
    </DictProvider>,
  );
}

const chipsOf = (row: HTMLElement) => within(row).getAllByTestId('step-chip');

describe('ParticipantsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each step as completed (with its closer), open current/required, or locked', async () => {
    api.listParticipants.mockResolvedValue(
      page([
        participant('u1', {
          source: 'self',
          steps: [
            {
              requirementId: REQ_1,
              currentCount: 3,
              targetCount: 3,
              checkedAt: '2026-10-05T10:00:00.000Z',
              completedAt: '2026-10-04T09:00:00.000Z',
              completedBy: 'reconcile',
            },
            {
              requirementId: REQ_2,
              currentCount: 0,
              targetCount: 1,
              checkedAt: '2026-10-05T10:00:00.000Z',
              completedAt: null,
              completedBy: null,
            },
          ],
        }),
      ]),
    );
    renderPanel();

    const row = (await screen.findByText('Student u1')).closest('tr') as HTMLElement;
    const chips = chipsOf(row);
    expect(chips.map((c) => c.dataset.state)).toEqual(['completed', 'open', 'locked']);

    expect(chips[0]).toHaveAttribute('title', 'Three demonstrations');
    expect(chips[0]).toHaveTextContent(d.chipCompleted('2026-10-04'));
    expect(within(chips[0]).getByTestId('step-chip-marker')).toHaveTextContent(d.completedBy.reconcile);
    expect(chips[1]).toHaveTextContent(d.chipOpen(0, 1));
    expect(chips[2]).toHaveTextContent(d.chipLocked);
    expect(chips[2]).toHaveAttribute('title', 'Watch the kata');

    expect(within(row).getByText(d.sources.self)).toBeInTheDocument();
    expect(within(row).getByText('2026-10-02')).toBeInTheDocument();
    expect(within(row).getByTestId('mission-completion')).toHaveTextContent(d.notCompleted);
    expect(api.listParticipants).toHaveBeenCalledWith(MISSION);
  });

  it('marks a hook-closed step, a left student, an email fallback and the mission completion date', async () => {
    const done = (requirementId: string, targetCount: number) => ({
      requirementId,
      currentCount: targetCount,
      targetCount,
      checkedAt: null,
      completedAt: '2026-10-06T12:00:00.000Z',
      completedBy: 'hook' as const,
    });
    api.listParticipants.mockResolvedValue(
      page([
        participant('u2', {
          name: null,
          source: 'admin',
          leftAt: '2026-10-07 09:00:00',
          progress: { currentValue: 3, targetValue: 3, completed: true, completedAt: '2026-10-06T12:00:00.000Z' },
          steps: [done(REQ_1, 3), done(REQ_2, 1), done(REQ_3, 2)],
        }),
      ]),
    );
    renderPanel();

    const row = (await screen.findByText('u2@example.com')).closest('tr') as HTMLElement;
    expect(chipsOf(row).map((c) => c.dataset.state)).toEqual(['completed', 'completed', 'completed']);
    expect(within(row).getAllByTestId('step-chip-marker')[0]).toHaveTextContent(d.completedBy.hook);
    expect(within(row).getByText(d.sources.admin)).toBeInTheDocument();
    expect(within(row).getByTestId('left-marker')).toHaveTextContent(d.leftMarker);
    expect(within(row).getByTestId('left-marker')).toHaveAttribute('title', d.leftOn('2026-10-07'));
    expect(within(row).getByTestId('mission-completion')).toHaveTextContent(d.completedOn('2026-10-06'));
  });

  it('opens every unevaluated step of a parallel mission at 0/target', () => {
    const chips = deriveStepChips(REQUIREMENTS, [], 'parallel');
    expect(chips.map((c) => c.state)).toEqual([
      { kind: 'open', current: 0, required: 3 },
      { kind: 'open', current: 0, required: 1 },
      { kind: 'open', current: 0, required: 2 },
    ]);
    // Sequential: the first step is open, the rest wait for it.
    expect(deriveStepChips(REQUIREMENTS, [], 'sequential').map((c) => c.state.kind)).toEqual([
      'open',
      'locked',
      'locked',
    ]);
  });

  it('appends the next cursor page on Load more', async () => {
    api.listParticipants
      .mockResolvedValueOnce(page([participant('u1')], 'cursor-1'))
      .mockResolvedValueOnce(page([participant('u2')], null));
    renderPanel();

    await screen.findByText('Student u1');
    fireEvent.click(screen.getByRole('button', { name: d.loadMore }));

    expect(await screen.findByText('Student u2')).toBeInTheDocument();
    expect(screen.getByText('Student u1')).toBeInTheDocument();
    expect(api.listParticipants).toHaveBeenLastCalledWith(MISSION, 'cursor-1');
    expect(screen.queryByRole('button', { name: d.loadMore })).not.toBeInTheDocument();
  });

  it('lets an admin reconcile now: shows the counts and reloads the first page', async () => {
    api.listParticipants
      .mockResolvedValueOnce(page([participant('u1')], 'cursor-1'))
      .mockResolvedValueOnce(
        page([
          participant('u1', {
            steps: [
              {
                requirementId: REQ_1,
                currentCount: 3,
                targetCount: 3,
                checkedAt: null,
                completedAt: '2026-10-08T00:00:00.000Z',
                completedBy: 'reconcile',
              },
            ],
          }),
        ]),
      );
    api.reconcile.mockResolvedValue({
      missions: 1,
      enrollmentsCreated: 2,
      evidenceBackfilled: 0,
      enrollmentsEvaluated: 12,
      stepsClosed: 4,
      missionsClosed: 1,
      failed: 0,
    });
    renderPanel({ canReconcile: true });
    await screen.findByText('Student u1');

    fireEvent.click(screen.getByRole('button', { name: d.reconcileButton }));

    expect(await screen.findByTestId('reconcile-result')).toHaveTextContent(d.reconcileResult(12, 4, 1, 2, 0));
    expect(d.reconcileResult(12, 4, 1, 2, 0)).toContain('2 enrollment(s) created');
    expect(d.reconcileResult(12, 4, 1, 0, 0)).not.toContain('created');
    expect(api.reconcile).toHaveBeenCalledWith(MISSION);
    await waitFor(() => expect(api.listParticipants).toHaveBeenCalledTimes(2));
    expect(api.listParticipants).toHaveBeenLastCalledWith(MISSION);
    const row = screen.getByText('Student u1').closest('tr') as HTMLElement;
    await waitFor(() => expect(chipsOf(row)[0].dataset.state).toBe('completed'));
    expect(screen.queryByRole('button', { name: d.loadMore })).not.toBeInTheDocument();
  });

  it('shows the reconcile error and keeps the list when the run fails', async () => {
    api.listParticipants.mockResolvedValue(page([participant('u1')]));
    api.reconcile.mockRejectedValue(new Error('boom'));
    renderPanel({ canReconcile: true });
    await screen.findByText('Student u1');
    fireEvent.click(screen.getByRole('button', { name: d.reconcileButton }));
    expect(await screen.findByText(d.reconcileError)).toBeInTheDocument();
    expect(screen.getByText('Student u1')).toBeInTheDocument();
  });

  it('hides Reconcile now from a content creator but still lists the rows', async () => {
    api.listParticipants.mockResolvedValue(page([participant('u1')]));
    renderPanel({ canReconcile: false });
    expect(await screen.findByText('Student u1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.reconcileButton })).not.toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    api.listParticipants.mockResolvedValue(page([]));
    renderPanel();
    expect(await screen.findByTestId('participants-empty')).toHaveTextContent(d.empty);
  });

  it('shows the load error with a retry', async () => {
    api.listParticipants.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(page([participant('u1')]));
    renderPanel();
    expect(await screen.findByText(d.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.retry }));
    expect(await screen.findByText('Student u1')).toBeInTheDocument();
  });
});
