import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMissionsApi } from '@web/lib/missions-api';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { MissionPage } from '../MissionPage';
import { entry, step, TOPIC } from './mission-fixtures';

const d = dictEn.missions;

// The real missions client over a fake transport, so the status → error mapping is exercised too.
// One client for every render, as the real `useApiClient()` memoises it: the page's load effect depends on it.
const http = vi.fn();
const client = { missions: createMissionsApi((...args) => http(...args)) };
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MISSION_ID = 'm1';

const VISIT = step({
  id: 's1',
  position: 1,
  kind: 'topic_visited',
  title: 'Visit Kihon',
  xpReward: 30,
  target: { type: 'topic', topicId: TOPIC, title: 'Kihon', accessible: true },
  state: 'completed',
  current: 1,
  required: 1,
});
const BOW = step({ id: 's2', position: 2, title: 'Bow to the dojo', xpReward: 15, instructions: 'Bow before entering.' });

function mission(overrides: Parameters<typeof entry>[2] = {}): DashboardMissionEntry {
  return entry(MISSION_ID, 'Kihon month', {
    enrollment: { source: 'auto', joinedAt: null, implicit: true },
    steps: [VISIT, BOW],
    ...overrides,
    mission: {
      mode: 'parallel',
      description: 'Train **every day**.',
      xpReward: 500,
      ...overrides.mission,
    },
  });
}

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <MissionPage missionId={MISSION_ID} />
    </DictProvider>,
  );
}

async function loaded(body: DashboardMissionEntry) {
  http.mockResolvedValueOnce(json(body));
  renderPage();
  await screen.findByRole('heading', { level: 1, name: body.mission.title });
}

const rowOf = (title: string) =>
  screen.getAllByTestId('mission-step').find((row) => within(row).queryByText(title) !== null)!;

beforeEach(() => {
  http.mockReset();
  push.mockReset();
});

describe('MissionPage', () => {
  it('renders the header, the Markdown description and every step', async () => {
    await loaded(mission({ mission: { mode: 'sequential', badgeId: 'b1' } }));

    expect(http).toHaveBeenCalledWith('GET', `/me/missions/${MISSION_ID}`);
    expect(screen.getByTestId('mission-mode')).toHaveTextContent(d.page.modes.sequential);
    expect(screen.getByTestId('mission-enrollment')).toHaveTextContent(d.page.enrollment.auto);
    expect(screen.getByText(d.page.missionXp(500))).toBeInTheDocument();
    expect(screen.getByText(d.card.badgeReward)).toBeInTheDocument();
    expect(screen.getByText(d.window.ends(d.window.date('Oct', 31)))).toBeInTheDocument();

    const description = screen.getByTestId('mission-description');
    expect(within(description).getByText('every day').tagName).toBe('STRONG');

    expect(screen.getAllByTestId('mission-step')).toHaveLength(2);
    expect(within(rowOf('Bow to the dojo')).getByText('Bow before entering.')).toBeInTheDocument();
  });

  it('says "in any order" for a parallel mission and the join date for a self enrollment', async () => {
    await loaded(mission({ enrollment: { source: 'self', joinedAt: '2026-10-05 10:00:00', implicit: false } }));
    expect(screen.getByTestId('mission-mode')).toHaveTextContent(d.page.modes.parallel);
    expect(screen.getByTestId('mission-enrollment')).toHaveTextContent(
      d.page.enrollment.self(d.window.date('Oct', 5)),
    );
  });

  it('asks for confirmation, calls the check route once and renders the step completed with its XP', async () => {
    await loaded(mission());
    const done = { ...BOW, current: 1, state: 'completed' as const, completedAt: '2026-10-03T00:00:00.000Z' };
    http.mockResolvedValueOnce(
      json({
        step: done,
        mission: mission({
          steps: [VISIT, done],
          progress: {
            userId: 'u1',
            missionId: MISSION_ID,
            currentValue: 2,
            targetValue: 2,
            completed: true,
            completedAt: '2026-10-03T00:00:00.000Z',
            updatedAt: '2026-10-03T00:00:00.000Z',
          },
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') }));
    const group = screen.getByRole('group', { name: d.check.confirmLabel('Bow to the dojo') });
    expect(within(group).getByText(d.check.confirmPrompt)).toBeInTheDocument();
    expect(http).toHaveBeenCalledTimes(1); // nothing sent before confirming

    fireEvent.click(within(group).getByRole('button', { name: d.check.confirm }));

    await waitFor(() => expect(rowOf('Bow to the dojo')).toHaveAttribute('data-state', 'completed'));
    expect(http).toHaveBeenCalledTimes(2);
    expect(http).toHaveBeenLastCalledWith('POST', `/me/missions/${MISSION_ID}/requirements/s2/check`);
    const row = rowOf('Bow to the dojo');
    expect(within(row).getByRole('img', { name: d.steps.completed })).toBeInTheDocument();
    expect(within(row).getByText(d.card.xp(15))).toBeInTheDocument();
    // The check is final: no button is left on the completed step.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(d.card.completed)).toBeInTheDocument();
  });

  it('cancelling the confirmation sends nothing', async () => {
    await loaded(mission());
    fireEvent.click(screen.getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') }));
    fireEvent.click(screen.getByRole('button', { name: d.check.cancel }));
    expect(screen.getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') })).toBeInTheDocument();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('renders a locked self-check disabled with its explanation', async () => {
    await loaded(
      mission({
        mission: { mode: 'sequential' },
        steps: [{ ...VISIT, state: 'open', current: 0 }, { ...BOW, state: 'locked' }],
      }),
    );
    const row = rowOf('Bow to the dojo');
    const button = within(row).getByRole('button', { name: d.check.button });
    expect(button).toBeDisabled();
    expect(within(row).getByText(d.check.lockedHint)).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(d.check.lockedHint);
  });

  it('shows the translated message on 409 MISSION_CLOSED and leaves the step open', async () => {
    await loaded(mission());
    http.mockResolvedValueOnce(json({ error: 'MISSION_CLOSED' }, 409));

    fireEvent.click(screen.getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') }));
    fireEvent.click(screen.getByRole('button', { name: d.check.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.check.closed);
    const row = rowOf('Bow to the dojo');
    expect(row).toHaveAttribute('data-state', 'open');
    expect(within(row).getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') })).toBeEnabled();
  });

  it('shows the locked message on 409 MISSION_STEP_LOCKED', async () => {
    await loaded(mission());
    http.mockResolvedValueOnce(json({ error: 'MISSION_STEP_LOCKED' }, 409));
    fireEvent.click(screen.getByRole('button', { name: d.check.buttonLabel('Bow to the dojo') }));
    fireEvent.click(screen.getByRole('button', { name: d.check.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.MISSION_STEP_LOCKED);
  });

  it('offers Leave only for a self enrollment', async () => {
    await loaded(mission({ enrollment: { source: 'admin', joinedAt: '2026-10-01 00:00:00', implicit: false } }));
    expect(screen.getByTestId('mission-enrollment')).toHaveTextContent(d.page.enrollment.admin);
    expect(screen.queryByRole('button', { name: d.leave.buttonLabel('Kihon month') })).not.toBeInTheDocument();
  });

  it('does not offer Leave for an automatic enrollment', async () => {
    await loaded(mission());
    expect(screen.queryByRole('button', { name: d.leave.buttonLabel('Kihon month') })).not.toBeInTheDocument();
  });

  it('leaves a self enrollment after confirming and returns to the dashboard', async () => {
    await loaded(mission({ enrollment: { source: 'self', joinedAt: '2026-10-05 10:00:00', implicit: false } }));
    http.mockResolvedValueOnce(new Response(null, { status: 204 }));

    fireEvent.click(screen.getByRole('button', { name: d.leave.buttonLabel('Kihon month') }));
    const group = screen.getByRole('group', { name: d.leave.confirmLabel('Kihon month') });
    expect(within(group).getByText(d.leave.confirmPrompt)).toBeInTheDocument();
    expect(http).toHaveBeenCalledTimes(1);

    fireEvent.click(within(group).getByRole('button', { name: d.leave.confirm }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(http).toHaveBeenLastCalledWith('POST', `/me/missions/${MISSION_ID}/leave`);
  });

  it('shows the reason when leaving is refused and stays on the page', async () => {
    await loaded(mission({ enrollment: { source: 'self', joinedAt: null, implicit: false } }));
    expect(screen.getByTestId('mission-enrollment')).toHaveTextContent(d.page.enrollment.selfUndated);
    http.mockResolvedValueOnce(json({ error: 'MISSION_NOT_LEAVABLE' }, 409));

    fireEvent.click(screen.getByRole('button', { name: d.leave.buttonLabel('Kihon month') }));
    fireEvent.click(screen.getByRole('button', { name: d.leave.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.MISSION_NOT_LEAVABLE);
    expect(push).not.toHaveBeenCalled();
  });

  it('renders the not-found state on a 404', async () => {
    http.mockResolvedValueOnce(json({ error: 'NotFound' }, 404));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: d.page.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByText(d.page.notFoundBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: d.page.backToDashboard })).toHaveAttribute('href', '/dashboard');
  });

  it('renders an error with a retry on a failure other than 404', async () => {
    http.mockResolvedValueOnce(json({ error: 'boom' }, 500));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(d.page.loadError);

    http.mockResolvedValueOnce(json(mission()));
    fireEvent.click(screen.getByRole('button', { name: d.page.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kihon month' })).toBeInTheDocument();
  });

  it('renders a redacted target without a link or a title', async () => {
    await loaded(
      mission({
        steps: [
          step({
            id: 's3',
            position: 1,
            kind: 'submissions_on_topic',
            title: 'Show your kata',
            target: { type: 'topic', topicId: null, title: null, accessible: false },
          }),
        ],
      }),
    );
    const row = rowOf('Show your kata');
    expect(within(row).getByTestId('mission-step-restricted')).toHaveTextContent(d.steps.restricted);
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    // Only manual_check steps carry a button.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Join instead of the self-checks to a student who has not joined an open mission', async () => {
    await loaded(mission({ enrollment: null, joinable: true, mission: { enrollmentMode: 'open' } }));
    expect(screen.getByRole('button', { name: d.join.buttonLabel('Kihon month') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.check.buttonLabel('Bow to the dojo') })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mission-enrollment')).not.toBeInTheDocument();
  });
});
