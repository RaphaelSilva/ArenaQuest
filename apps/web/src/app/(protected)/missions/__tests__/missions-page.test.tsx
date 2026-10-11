import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMissionsApi, type DashboardMissionEntry } from '@web/lib/missions-api';
import { entry, step } from '@web/components/missions/__tests__/mission-fixtures';
import MissionsPage from '../page';

const d = dictEn.missions;

// The real missions client over a fake transport, so the route and the status mapping are exercised too.
// One client for every render, as the real `useApiClient()` memoises it: the page's load effect depends on it.
const http = vi.fn();
const client = { missions: createMissionsApi((...args) => http(...args)) };
vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const progress = (missionId: string, currentValue: number, targetValue: number, completed: boolean) => ({
  userId: 'u1',
  missionId,
  currentValue,
  targetValue,
  completed,
  completedAt: completed ? '2026-10-05T00:00:00.000Z' : null,
  updatedAt: '2026-10-05T00:00:00.000Z',
});

const IN_PROGRESS = entry('m-run', 'Kihon month', {
  enrollment: { source: 'auto', joinedAt: null, implicit: true },
  progress: progress('m-run', 1, 2, false),
  steps: [step({ id: 's1', position: 1, title: 'Bow', state: 'completed' }), step({ id: 's2', position: 2 })],
});

const DONE = entry('m-done', 'Kata week', {
  enrollment: { source: 'admin', joinedAt: null, implicit: false },
  progress: progress('m-done', 2, 2, true),
});

const LEGACY = entry('m-legacy', 'Old challenge', { progress: progress('m-legacy', 3, 4, false) });

const OPEN = entry('m-open', 'Open seminar', { mission: { enrollmentMode: 'open' }, joinable: true });

const TEASER = entry('m-locked', 'Black belt kata', {
  mission: { enrollmentMode: 'assigned' },
  locked: { reason: 'assigned', groups: ['Black Belt'] },
});

const JOINED: DashboardMissionEntry = {
  ...OPEN,
  joinable: false,
  enrollment: { source: 'self', joinedAt: '2026-10-03T10:00:00.000Z', implicit: false },
  steps: [step({ id: 'o1', position: 1, title: 'Attend' })],
};

const ALL = [IN_PROGRESS, DONE, LEGACY, OPEN, TEASER];

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <MissionsPage />
    </DictProvider>,
  );
}

const group = (id: 'mine' | 'available' | 'locked') => screen.getByTestId(`missions-group-${id}`);
const filterButton = (label: string) =>
  within(screen.getByRole('group', { name: d.index.filterLabel })).getByRole('button', { name: label });

async function renderLoaded(entries: DashboardMissionEntry[] | null) {
  http.mockResolvedValueOnce(json(entries));
  renderPage();
  await screen.findByRole('group', { name: d.index.filterLabel });
}

beforeEach(() => {
  http.mockReset();
});

describe('Missions page', () => {
  it('loads GET /me/missions and renders every entry in its group', async () => {
    await renderLoaded(ALL);

    expect(http).toHaveBeenCalledWith('GET', '/me/missions');
    expect(screen.getByRole('heading', { level: 1, name: d.index.title })).toBeInTheDocument();
    expect(within(group('mine')).getByRole('heading', { level: 2, name: d.groups.mine })).toBeInTheDocument();
    expect(within(group('mine')).getAllByTestId('mission-card')).toHaveLength(3);
    expect(within(group('available')).getByText('Open seminar')).toBeInTheDocument();
    expect(within(group('locked')).getByText('Black belt kata')).toBeInTheDocument();
    expect(within(group('locked')).getByText(d.locked.reason(['Black Belt']))).toBeInTheDocument();
  });

  it('links each enrolled card to its mission page', async () => {
    await renderLoaded([IN_PROGRESS]);
    expect(within(group('mine')).getByRole('link', { name: 'Kihon month' })).toHaveAttribute(
      'href',
      '/missions/m-run',
    );
  });

  it('keeps the single bar of a legacy mission, with no step list', async () => {
    await renderLoaded([LEGACY]);
    const card = within(group('mine')).getByTestId('mission-card');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    expect(within(card).queryByRole('list')).not.toBeInTheDocument();
  });

  it('starts on All, with every filter offered', async () => {
    await renderLoaded(ALL);
    for (const label of Object.values(d.index.filters)) expect(filterButton(label)).toBeInTheDocument();
    expect(filterButton(d.index.filters.all)).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by In progress and Completed within My missions', async () => {
    await renderLoaded(ALL);

    fireEvent.click(filterButton(d.index.filters.inProgress));
    expect(filterButton(d.index.filters.inProgress)).toHaveAttribute('aria-pressed', 'true');
    expect(within(group('mine')).getByText('Kihon month')).toBeInTheDocument();
    expect(within(group('mine')).getByText('Old challenge')).toBeInTheDocument();
    expect(within(group('mine')).queryByText('Kata week')).not.toBeInTheDocument();
    expect(screen.queryByTestId('missions-group-available')).not.toBeInTheDocument();
    expect(screen.queryByTestId('missions-group-locked')).not.toBeInTheDocument();

    fireEvent.click(filterButton(d.index.filters.completed));
    expect(within(group('mine')).getAllByTestId('mission-card')).toHaveLength(1);
    expect(within(group('mine')).getByText('Kata week')).toBeInTheDocument();
  });

  it('filters by Available and Locked', async () => {
    await renderLoaded(ALL);

    fireEvent.click(filterButton(d.index.filters.available));
    expect(within(group('available')).getByText('Open seminar')).toBeInTheDocument();
    expect(screen.queryByTestId('missions-group-mine')).not.toBeInTheDocument();

    fireEvent.click(filterButton(d.index.filters.locked));
    expect(within(group('locked')).getByText('Black belt kata')).toBeInTheDocument();
    expect(screen.queryByTestId('missions-group-available')).not.toBeInTheDocument();
  });

  it('shows the filter empty state when a filter matches nothing', async () => {
    await renderLoaded([IN_PROGRESS]);
    fireEvent.click(filterButton(d.index.filters.completed));
    expect(within(group('mine')).getByText(d.index.filterEmpty.completed)).toBeInTheDocument();
  });

  it('shows each group empty state under All', async () => {
    await renderLoaded([TEASER]);
    expect(within(group('mine')).getByText(d.empty.mine)).toBeInTheDocument();
    expect(within(group('available')).getByText(d.empty.available)).toBeInTheDocument();
  });

  it.each([
    ['an empty list', []],
    ['null', null],
  ])('shows the page empty state for %s', async (_label, body) => {
    http.mockResolvedValueOnce(json(body));
    renderPage();
    expect(await screen.findByText(d.index.empty)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: d.index.filterLabel })).not.toBeInTheDocument();
  });

  it('confirms, joins once and moves the card to My missions', async () => {
    await renderLoaded([IN_PROGRESS, OPEN]);
    http.mockResolvedValueOnce(json(JOINED, 201));

    fireEvent.click(within(group('available')).getByRole('button', { name: d.join.buttonLabel('Open seminar') }));
    expect(screen.getByText(d.join.confirmPrompt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.join.confirm }));

    await waitFor(() => expect(within(group('mine')).getByText('Open seminar')).toBeInTheDocument());
    expect(http).toHaveBeenCalledTimes(2);
    expect(http).toHaveBeenLastCalledWith('POST', '/me/missions/m-open/join');
    expect(within(group('available')).getByText(d.empty.available)).toBeInTheDocument();
    expect(within(group('mine')).getByRole('link', { name: 'Open seminar' })).toHaveAttribute(
      'href',
      '/missions/m-open',
    );
  });

  it('shows the translated reason of a refused join and keeps the card available', async () => {
    await renderLoaded([OPEN]);
    http.mockResolvedValueOnce(json({ error: 'MISSION_CLOSED' }, 409));

    fireEvent.click(screen.getByRole('button', { name: d.join.buttonLabel('Open seminar') }));
    fireEvent.click(screen.getByRole('button', { name: d.join.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.errors.MISSION_CLOSED);
    expect(within(group('available')).getByText('Open seminar')).toBeInTheDocument();
  });

  it('shows a load error with a retry that reloads', async () => {
    http.mockResolvedValueOnce(json({ error: 'Boom' }, 500));
    renderPage();
    expect(await screen.findByText(d.index.loadError)).toBeInTheDocument();

    http.mockResolvedValueOnce(json([OPEN]));
    fireEvent.click(screen.getByRole('button', { name: d.index.retry }));
    expect(await screen.findByText('Open seminar')).toBeInTheDocument();
    expect(http).toHaveBeenCalledTimes(2);
  });
});
