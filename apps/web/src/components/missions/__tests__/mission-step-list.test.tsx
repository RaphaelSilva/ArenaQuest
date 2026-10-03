import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { MissionStepList } from '../MissionStepList';
import { formatMissionDate } from '../mission-date';
import { stepTargetView } from '../step-target';
import { step, TOPIC } from './mission-fixtures';

const d = dictEn.missions;

const STEPS = [
  step({
    id: 'r1',
    position: 1,
    kind: 'submissions_on_topic',
    title: 'Three demonstrations',
    xpReward: 50,
    target: { type: 'topic', topicId: TOPIC, title: 'Kihon', accessible: true },
    current: 3,
    required: 3,
    state: 'completed',
    completedAt: '2026-10-02T00:00:00.000Z',
  }),
  step({
    id: 'r2',
    position: 2,
    kind: 'video_watched',
    title: 'Watch the kata',
    xpReward: 20,
    target: { type: 'topic', topicId: TOPIC, title: 'Kata', accessible: true },
    current: 1,
    required: 2,
    state: 'open',
  }),
  step({
    id: 'r3',
    position: 3,
    kind: 'event_participation',
    title: 'Attend the seminar',
    xpReward: 100,
    target: { type: 'event', slug: 'seminar-2026', title: 'Seminar', startsAt: null },
    state: 'locked',
  }),
];

function renderList(props: Partial<Parameters<typeof MissionStepList>[0]> = {}) {
  return render(
    <DictProvider value={dictEn}>
      <MissionStepList title="Kihon month" mode="sequential" steps={STEPS} compact {...props} />
    </DictProvider>,
  );
}

describe('MissionStepList', () => {
  it('numbers the steps of a sequential mission and renders the later ones locked', () => {
    renderList();
    const list = screen.getByRole('list', { name: d.steps.listLabel('Kihon month') });
    const rows = within(list).getAllByTestId('mission-step');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => within(r).getByTestId('mission-step-number').textContent)).toEqual([
      d.steps.number(1),
      d.steps.number(2),
      d.steps.number(3),
    ]);
    expect(rows[2]).toHaveAttribute('data-state', 'locked');
    expect(within(rows[2]).getByRole('img', { name: d.steps.locked })).toBeInTheDocument();
  });

  it('hides the numbers of a parallel mission', () => {
    renderList({ mode: 'parallel' });
    expect(screen.queryByTestId('mission-step-number')).not.toBeInTheDocument();
  });

  it('shows a check and the XP on a completed step, a counter on an open one', () => {
    renderList();
    const [done, open] = screen.getAllByTestId('mission-step');
    expect(within(done).getByRole('img', { name: d.steps.completed })).toBeInTheDocument();
    expect(within(done).getByText(d.card.xp(50))).toBeInTheDocument();
    expect(within(open).getByRole('img', { name: d.steps.progress(1, 2) })).toHaveTextContent(d.steps.counter(1, 2));
  });

  it('links each target by kind: submissions, catalog topic and event', () => {
    renderList();
    expect(screen.getByRole('link', { name: 'Kihon' })).toHaveAttribute('href', `/catalog/${TOPIC}/submissions`);
    expect(screen.getByRole('link', { name: 'Kata' })).toHaveAttribute('href', `/catalog/${TOPIC}`);
    expect(screen.getByRole('link', { name: 'Seminar' })).toHaveAttribute('href', '/events/seminar-2026');
  });

  it('renders a redacted target with no link and no title', () => {
    renderList({
      steps: [
        step({
          id: 'r9',
          position: 1,
          kind: 'topic_visited',
          title: 'Visit the secret topic',
          target: { type: 'topic', topicId: null, title: null, accessible: false },
        }),
        step({
          id: 'r10',
          position: 2,
          kind: 'event_participation',
          title: 'Attend',
          target: { type: 'event', slug: null, title: null, startsAt: null },
        }),
      ],
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('mission-step-restricted')).toHaveLength(2);
    expect(screen.getAllByText(d.steps.restricted)).toHaveLength(2);
  });

  it('never shows a title the server marked inaccessible', () => {
    expect(
      stepTargetView({ kind: 'topic_visited', target: { type: 'topic', topicId: TOPIC, title: 'Leaked', accessible: false } }),
    ).toEqual({ kind: 'restricted' });
  });

  it('shows the self-check hint for a manual_check step in compact mode, its instructions otherwise', () => {
    const manual = [step({ id: 'm1', position: 1, title: 'Bow', instructions: 'Bow before class.' })];
    const { unmount } = renderList({ steps: manual });
    expect(screen.getByText(d.steps.selfCheck)).toBeInTheDocument();
    unmount();
    renderList({ steps: manual, compact: false });
    expect(screen.getByText('Bow before class.')).toBeInTheDocument();
  });
});

describe('formatMissionDate', () => {
  it('formats the calendar day from the dictionary, without Intl', () => {
    expect(formatMissionDate('2026-10-31T23:59:59.000Z', dictEn.missions)).toBe('Oct 31');
    expect(formatMissionDate('not a date', dictEn.missions)).toBeNull();
    expect(formatMissionDate(null, dictEn.missions)).toBeNull();
  });
});
