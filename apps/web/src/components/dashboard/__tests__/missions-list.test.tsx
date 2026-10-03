import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMissionsApi } from '@web/lib/missions-api';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { MissionsList, groupMissions } from '../MissionsList';
import { entry, step, TOPIC } from '../../missions/__tests__/mission-fixtures';

const d = dictEn.missions;

// The real missions client over a fake transport, so the status → error mapping is exercised too.
const http = vi.fn();
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({ missions: createMissionsApi((...args) => http(...args)) }),
  };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ENROLLED = entry('m-enrolled', 'Kihon month', {
  mission: { mode: 'sequential', xpReward: 500 },
  enrollment: { source: 'auto', joinedAt: null, implicit: true },
  progress: {
    userId: 'u1',
    missionId: 'm-enrolled',
    currentValue: 1,
    targetValue: 2,
    completed: false,
    completedAt: null,
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
  steps: [
    step({
      id: 's1',
      position: 1,
      kind: 'topic_visited',
      title: 'Visit Kihon',
      xpReward: 30,
      target: { type: 'topic', topicId: TOPIC, title: 'Kihon', accessible: true },
      current: 1,
      required: 1,
      state: 'completed',
    }),
    step({ id: 's2', position: 2, title: 'Bow', state: 'locked' }),
  ],
});

const OPEN = entry('m-open', 'Open seminar', { mission: { enrollmentMode: 'open' }, joinable: true });

const TEASER = entry('m-locked', 'Black belt kata', {
  mission: { enrollmentMode: 'assigned', description: 'Secret description' },
  locked: { reason: 'assigned', groups: ['Black Belt'] },
});

const LEGACY = entry('m-legacy', 'Old challenge', {
  progress: {
    userId: 'u1',
    missionId: 'm-legacy',
    currentValue: 3,
    targetValue: 4,
    completed: false,
    completedAt: null,
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
});

const JOINED: DashboardMissionEntry = {
  ...OPEN,
  joinable: false,
  enrollment: { source: 'self', joinedAt: '2026-10-03T10:00:00.000Z', implicit: false },
  steps: [step({ id: 'o1', position: 1, title: 'Attend', state: 'open' })],
};

function renderList(missions: DashboardMissionEntry[]) {
  return render(
    <DictProvider value={dictEn}>
      <MissionsList missions={missions} />
    </DictProvider>,
  );
}

const group = (id: 'mine' | 'available' | 'locked') => screen.getByTestId(`missions-group-${id}`);

beforeEach(() => {
  http.mockReset();
});

describe('MissionsList', () => {
  it('splits enrolled, joinable and teaser entries into their groups', () => {
    renderList([ENROLLED, OPEN, TEASER, LEGACY]);

    expect(within(group('mine')).getByRole('heading', { name: d.groups.mine })).toBeInTheDocument();
    expect(within(group('mine')).getByText('Kihon month')).toBeInTheDocument();
    expect(within(group('mine')).getByText('Old challenge')).toBeInTheDocument();
    expect(within(group('available')).getByText('Open seminar')).toBeInTheDocument();
    expect(within(group('locked')).getByText('Black belt kata')).toBeInTheDocument();

    expect(groupMissions([ENROLLED, OPEN, TEASER, LEGACY])).toEqual({
      mine: [ENROLLED, LEGACY],
      available: [OPEN],
      locked: [TEASER],
    });
  });

  it('renders a my-mission card with its link, window, bar and step list', () => {
    renderList([ENROLLED]);
    const card = within(group('mine')).getByTestId('mission-card');
    expect(within(card).getByRole('link', { name: 'Kihon month' })).toHaveAttribute('href', '/missions/m-enrolled');
    expect(within(card).getByText(d.window.ends('Oct 31'))).toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: d.card.progressLabel('Kihon month', 1, 2) })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(within(card).getByText(d.card.xp(500))).toBeInTheDocument();
    const steps = within(card).getAllByTestId('mission-step');
    expect(steps).toHaveLength(2);
    expect(within(steps[1]).getByRole('img', { name: d.steps.locked })).toBeInTheDocument();
  });

  it('shows the Completed state on a completed mission', () => {
    renderList([{ ...ENROLLED, progress: { ...ENROLLED.progress!, currentValue: 2, completed: true } }]);
    expect(within(group('mine')).getByText(d.card.completed)).toBeInTheDocument();
  });

  it('keeps the single bar for a legacy mission, with no step list', () => {
    renderList([LEGACY]);
    const card = within(group('mine')).getByTestId('mission-card');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    expect(within(card).queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders a teaser with only its title and group reason, and no link', () => {
    renderList([TEASER]);
    const card = within(group('locked')).getByTestId('mission-card');
    expect(within(card).getByText('Black belt kata')).toBeInTheDocument();
    expect(within(card).getByText(d.locked.reason(['Black Belt']))).toBeInTheDocument();
    expect(within(card).getByText(d.locked.reason(['Black Belt']))).toHaveTextContent('For the Black Belt group');
    expect(within(card).getByRole('img', { name: d.card.lockedIcon })).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByText('Secret description')).not.toBeInTheDocument();
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('asks for confirmation, joins once and moves the card to My missions', async () => {
    http.mockResolvedValueOnce(json(JOINED, 201));
    renderList([ENROLLED, OPEN]);

    fireEvent.click(within(group('available')).getByRole('button', { name: d.join.buttonLabel('Open seminar') }));
    expect(http).not.toHaveBeenCalled();
    expect(screen.getByText(d.join.confirmPrompt)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: d.join.confirm }));

    await waitFor(() => expect(within(group('mine')).getByText('Open seminar')).toBeInTheDocument());
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith('POST', '/me/missions/m-open/join');
    expect(within(group('available')).getByText(d.empty.available)).toBeInTheDocument();
  });

  it('cancelling the confirmation does not call the join route', () => {
    renderList([OPEN]);
    fireEvent.click(screen.getByRole('button', { name: d.join.buttonLabel('Open seminar') }));
    fireEvent.click(screen.getByRole('button', { name: d.join.cancel }));
    expect(http).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: d.join.buttonLabel('Open seminar') })).toBeInTheDocument();
  });

  it('shows the translated reason of a 409 MISSION_CLOSED and keeps the card available', async () => {
    http.mockResolvedValueOnce(json({ error: 'MISSION_CLOSED' }, 409));
    renderList([OPEN]);

    fireEvent.click(screen.getByRole('button', { name: d.join.buttonLabel('Open seminar') }));
    fireEvent.click(screen.getByRole('button', { name: d.join.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.MISSION_CLOSED);
    expect(within(group('available')).getByText('Open seminar')).toBeInTheDocument();
    expect(within(group('mine')).getByText(d.empty.mine)).toBeInTheDocument();
  });

  it('renders each group empty state, and the panel empty state with no missions', () => {
    const { unmount } = renderList([TEASER]);
    expect(within(group('mine')).getByText(d.empty.mine)).toBeInTheDocument();
    expect(within(group('available')).getByText(d.empty.available)).toBeInTheDocument();
    unmount();

    renderList([ENROLLED]);
    expect(within(group('locked')).getByText(d.empty.locked)).toBeInTheDocument();
  });

  it('renders the panel empty state when there are no missions', () => {
    renderList([]);
    expect(screen.getByText(dictEn.dashboard.missions.empty)).toBeInTheDocument();
  });
});
