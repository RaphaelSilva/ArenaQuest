import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type { MissionMode } from '@web/lib/admin-gamification-api';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { RequirementEditor } from '../RequirementEditor';
import { emptyStep, type StepDraft } from '../mission-draft';
import type { TopicMediaStat } from '../use-topic-media-stats';

const d = dictEn.admin.missions.requirements;

const TOPIC_A = '11111111-1111-4111-8111-111111111111';
const TOPIC_B = '22222222-2222-4222-8222-222222222222';
const EVENT_PRICED = '33333333-3333-4333-8333-333333333333';
const EVENT_FREE = '44444444-4444-4444-8444-444444444444';

const topic = (id: string, title: string, extra: Partial<TopicNode> = {}): TopicNode => ({
  id,
  parentId: null,
  title,
  content: '',
  status: 'published',
  archived: false,
  order: 0,
  estimatedMinutes: 0,
  tags: [],
  prerequisiteIds: [],
  ...extra,
});

const TOPICS: TopicNode[] = [
  topic(TOPIC_A, 'Kihon'),
  topic(TOPIC_B, 'Kata'),
  topic('55555555-5555-4555-8555-555555555555', 'Draft topic', { status: 'draft' }),
];

const event = (id: string, title: string): AdminEvent =>
  ({ id, title, status: 'published' }) as AdminEvent;

const EVENTS = [event(EVENT_PRICED, 'Summer seminar'), event(EVENT_FREE, 'Open class')];

type HarnessProps = {
  initial?: StepDraft[];
  mode?: MissionMode;
  structureLocked?: boolean;
  errors?: Record<number, string>;
  mediaStats?: Record<string, TopicMediaStat>;
  onSteps?: (steps: StepDraft[]) => void;
};

function Harness({ initial = [], mode = 'sequential', structureLocked = false, errors = {}, mediaStats = {}, onSteps }: HarnessProps) {
  const [steps, setSteps] = useState(initial);
  return (
    <RequirementEditor
      steps={steps}
      onChange={(next) => {
        setSteps(next);
        onSteps?.(next);
      }}
      mode={mode}
      structureLocked={structureLocked}
      titleLocked={structureLocked}
      errors={errors}
      topics={TOPICS}
      events={EVENTS}
      eventPriced={{ [EVENT_PRICED]: true, [EVENT_FREE]: false }}
      mediaStats={mediaStats}
    />
  );
}

function renderEditor(props: HarnessProps = {}) {
  return render(
    <DictProvider value={dictEn}>
      <Harness {...props} />
    </DictProvider>,
  );
}

function addStep(kind: keyof typeof d.kinds) {
  fireEvent.change(screen.getByLabelText(d.kindPicker), { target: { value: kind } });
  fireEvent.click(screen.getByRole('button', { name: d.addStep }));
}

const cards = () => screen.getAllByTestId('requirement-card');

describe('RequirementEditor', () => {
  it('starts empty and offers every kind', () => {
    renderEditor();
    expect(screen.getByText(d.empty)).toBeInTheDocument();
    const options = within(screen.getByLabelText(d.kindPicker)).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(Object.values(d.kinds));
  });

  it('adds a demonstrations step with the owner defaults: any, description optional, moderated off', () => {
    renderEditor();
    addStep('submissions_on_topic');
    const card = cards()[0];
    expect(within(card).getByText(d.kinds.submissions_on_topic)).toBeInTheDocument();
    expect(within(card).getByLabelText(d.fields.minCount)).toHaveValue(1);
    expect(within(card).getByLabelText(d.fields.visibilityAny)).toBeChecked();
    expect(within(card).getByLabelText(d.fields.visibilitySharedOnly)).not.toBeChecked();
    expect(within(card).getByLabelText(d.fields.requireDescription)).not.toBeChecked();
    expect(within(card).getByLabelText(d.fields.countModerated)).not.toBeChecked();
    expect(within(card).getByLabelText(d.fields.xpReward)).toHaveValue(0);
    // Only published, non-archived topics are offered.
    expect(within(card).getByRole('checkbox', { name: /Kihon/ })).toBeInTheDocument();
    expect(within(card).queryByRole('checkbox', { name: /Draft topic/ })).not.toBeInTheDocument();
  });

  it('renders the fields of the visit, video, self-check and event kinds', () => {
    renderEditor();
    addStep('topic_visited');
    addStep('video_watched');
    addStep('manual_check');
    addStep('event_participation');
    const [visit, video, check, evt] = cards();

    expect(within(visit).getByText(d.visitHint)).toBeInTheDocument();
    expect(within(visit).queryByLabelText(d.fields.minCount)).not.toBeInTheDocument();
    expect(within(visit).getByRole('checkbox', { name: /Kihon/ })).toBeInTheDocument();

    expect(within(video).getByLabelText(d.fields.minCount)).toHaveValue(1);
    expect(within(video).queryByLabelText(d.fields.countModerated)).not.toBeInTheDocument();

    expect(within(check).getByLabelText(d.fields.instructions)).toHaveValue('');
    expect(within(check).queryByText(d.topicNone)).not.toBeInTheDocument();

    const select = within(evt).getByLabelText(d.fields.event);
    expect(within(select).getByRole('option', { name: 'Summer seminar' })).not.toBeDisabled();
    expect(within(select).getByRole('option', { name: d.eventUnpriced('Open class') })).toBeDisabled();
  });

  it('keeps one topic per step (single select over the topic picker)', () => {
    renderEditor();
    addStep('topic_visited');
    const card = cards()[0];
    fireEvent.click(within(card).getByRole('checkbox', { name: /Kihon/ }));
    expect(within(card).getByText(d.topicSelected('Kihon'))).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('checkbox', { name: /Kata/ }));
    expect(within(card).getByText(d.topicSelected('Kata'))).toBeInTheDocument();
    expect(within(card).getByRole('checkbox', { name: /Kihon/ })).not.toBeChecked();
  });

  it('warns when a visited topic has no media and shows the video count for a video step', () => {
    const visit = { ...emptyStep('topic_visited'), topicId: TOPIC_A };
    const video = { ...emptyStep('video_watched'), topicId: TOPIC_B };
    renderEditor({
      initial: [visit, video],
      mediaStats: {
        [TOPIC_A]: { status: 'ready', media: 0, videos: 0 },
        [TOPIC_B]: { status: 'ready', media: 3, videos: 2 },
      },
    });
    expect(within(cards()[0]).getByText(d.noMediaWarning)).toBeInTheDocument();
    expect(within(cards()[1]).getByText(d.videoCount(2))).toBeInTheDocument();
    expect(within(cards()[1]).getByLabelText(d.fields.minCount)).toHaveAttribute('max', '2');
  });

  it('pre-fills a higher XP on a shared-only step next to an any step on the same topic', () => {
    const privateStep = { ...emptyStep('submissions_on_topic'), title: 'Private', topicId: TOPIC_A, xpReward: '40' };
    renderEditor({ initial: [privateStep] });
    addStep('submissions_on_topic');
    const shared = cards()[1];
    fireEvent.click(within(shared).getByRole('checkbox', { name: /Kihon/ }));
    expect(within(shared).getByLabelText(d.fields.xpReward)).toHaveValue(0);
    fireEvent.click(within(shared).getByLabelText(d.fields.visibilitySharedOnly));
    expect(within(shared).getByLabelText(d.fields.xpReward)).toHaveValue(60);
    expect(within(shared).getByText(d.sharedXpHint)).toBeInTheDocument();

    // Still editable.
    fireEvent.change(within(shared).getByLabelText(d.fields.xpReward), { target: { value: '45' } });
    expect(within(shared).getByLabelText(d.fields.xpReward)).toHaveValue(45);
    expect(within(shared).queryByText(d.sharedXpHint)).not.toBeInTheDocument();
  });

  it('does not pre-fill when the shared step targets another topic', () => {
    const privateStep = { ...emptyStep('submissions_on_topic'), topicId: TOPIC_A, xpReward: '40' };
    renderEditor({ initial: [privateStep] });
    addStep('submissions_on_topic');
    const shared = cards()[1];
    fireEvent.click(within(shared).getByRole('checkbox', { name: /Kata/ }));
    fireEvent.click(within(shared).getByLabelText(d.fields.visibilitySharedOnly));
    expect(within(shared).getByLabelText(d.fields.xpReward)).toHaveValue(0);
  });

  it('reorders by the up/down buttons and numbers the cards in sequential mode', () => {
    const onSteps = vi.fn();
    const first = { ...emptyStep('manual_check'), title: 'First' };
    const second = { ...emptyStep('manual_check'), title: 'Second' };
    renderEditor({ initial: [first, second], onSteps });

    expect(screen.getAllByTestId('step-number').map((n) => n.textContent)).toEqual(['1', '2']);
    expect(screen.getByRole('button', { name: d.moveUp(1) })).toBeDisabled();
    expect(screen.getByRole('button', { name: d.moveDown(2) })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: d.moveDown(1) }));
    expect(onSteps).toHaveBeenLastCalledWith([second, first]);
    expect(within(cards()[0]).getByLabelText(d.fields.title)).toHaveValue('Second');

    fireEvent.click(screen.getByRole('button', { name: d.moveUp(2) }));
    expect(within(cards()[0]).getByLabelText(d.fields.title)).toHaveValue('First');
  });

  it('reorders by drag and drop', () => {
    const first = { ...emptyStep('manual_check'), title: 'First' };
    const second = { ...emptyStep('manual_check'), title: 'Second' };
    renderEditor({ initial: [first, second] });
    fireEvent.dragStart(cards()[1]);
    fireEvent.dragOver(cards()[0]);
    fireEvent.drop(cards()[0]);
    expect(within(cards()[0]).getByLabelText(d.fields.title)).toHaveValue('Second');
  });

  it('hides the numbers in parallel mode', () => {
    renderEditor({ initial: [emptyStep('manual_check'), emptyStep('manual_check')], mode: 'parallel' });
    expect(screen.queryAllByTestId('step-number')).toHaveLength(0);
    expect(cards()).toHaveLength(2);
  });

  it('removes a step', () => {
    renderEditor({ initial: [{ ...emptyStep('manual_check'), title: 'Gone' }] });
    fireEvent.click(screen.getByRole('button', { name: d.remove(1) }));
    expect(screen.getByText(d.empty)).toBeInTheDocument();
  });

  it('shows an error on the card at its index', () => {
    renderEditor({
      initial: [emptyStep('manual_check'), emptyStep('manual_check')],
      errors: { 1: 'Topic archived' },
    });
    expect(within(cards()[1]).getByRole('alert')).toHaveTextContent('Topic archived');
    expect(within(cards()[0]).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('locks everything but nothing is added, moved or removed when structure-locked', () => {
    renderEditor({ initial: [{ ...emptyStep('manual_check'), title: 'Locked' }], structureLocked: true });
    expect(screen.queryByRole('button', { name: d.addStep })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.moveDown(1) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.remove(1) })).not.toBeInTheDocument();
    expect(within(cards()[0]).getByLabelText(d.fields.instructions)).toBeDisabled();
    expect(within(cards()[0]).getByLabelText(d.fields.xpReward)).toBeDisabled();
  });
});
