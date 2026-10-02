import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { SubmissionsApiError } from '@web/lib/submissions-api';
import type { TopicNode } from '@web/lib/topics-api';
import { summary, view } from './fixtures';

const mockClient = {
  topics: { list: vi.fn() },
  submissions: { summary: vi.fn(), move: vi.fn() },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { MoveDialog, moveTargets } from '../MoveDialog';

const t = dictPt.submissions.move;

function topic(id: string, title: string, parentId: string | null = null, order = 0, extra: Partial<TopicNode> = {}): TopicNode {
  return { id, title, parentId, order, status: 'published', archived: false, ...extra } as TopicNode;
}

/** The catalog the student can read: the source `t1`, two targets and an archived leftover. */
const catalog = [
  topic('t1', 'Kihon', null, 1),
  topic('t2', 'Kata', null, 2),
  topic('t3', 'Heian Shodan', 't2', 1),
  topic('t4', 'Old', null, 3, { archived: true }),
];

/** Free slots per topic: `perTopicMax` 10 minus the caller's count there. */
function slots(byTopic: Record<string, number>) {
  mockClient.submissions.summary.mockImplementation(async (id: string) =>
    summary({ usage: { topicCount: 10 - (byTopic[id] ?? 10), bytes: 0 } }),
  );
}

describe('moveTargets', () => {
  it('orders the tree depth-first, drops archived topics and excludes the source', () => {
    expect(moveTargets(catalog, new Set(['t1']))).toEqual([
      { id: 't2', title: 'Kata', depth: 0 },
      { id: 't3', title: 'Heian Shodan', depth: 1 },
    ]);
  });

  it('keeps a topic whose parent is not readable, as a root', () => {
    expect(moveTargets([topic('c', 'Child', 'hidden')], new Set())).toEqual([{ id: 'c', title: 'Child', depth: 0 }]);
  });
});

describe('MoveDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.topics.list.mockResolvedValue(catalog);
  });

  it('lists only readable targets with their free slots, never the current topic, and warns they become private', async () => {
    slots({ t2: 4, t3: 1 });
    render(<MoveDialog submissions={[view({ id: 'a', title: 'Kata A' })]} onMoved={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: t.heading(1) });
    expect(within(dialog).getByRole('note')).toHaveTextContent(t.privateWarning);

    const kata = await within(dialog).findByRole('radio', { name: new RegExp(`Kata .*${t.freeSlots(4)}`) });
    expect(kata).toBeEnabled();
    await within(dialog).findByText(t.freeSlots(1));
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['t2', 't3']);
    expect(within(dialog).queryByText('Kihon')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Old')).not.toBeInTheDocument();
  });

  it('drops a target whose summary answers 404 (no longer readable) and disables a full one', async () => {
    mockClient.submissions.summary.mockImplementation(async (id: string) => {
      if (id === 't3') throw new SubmissionsApiError('NotFound', 404, 'Not found.');
      return summary({ usage: { topicCount: 10, bytes: 0 } });
    });
    render(<MoveDialog submissions={[view({ id: 'a' })]} onMoved={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText(t.freeSlots(0));
    await waitFor(() => expect(screen.queryByText('Heian Shodan')).not.toBeInTheDocument());
    expect(screen.getByRole('radio')).toBeDisabled();
  });

  it('moves a single submission and reports it moved to the target', async () => {
    slots({ t2: 4, t3: 1 });
    const moved = view({ id: 'a', title: 'Kata A', topicNodeId: 't2' });
    mockClient.submissions.move.mockResolvedValue({ moved: [moved], refused: [] });
    const onMoved = vi.fn();
    render(<MoveDialog submissions={[view({ id: 'a', title: 'Kata A' })]} onMoved={onMoved} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Kata / }));
    fireEvent.click(screen.getByRole('button', { name: t.submit }));

    expect(await screen.findByText(t.resultMoved(1, 'Kata'))).toBeInTheDocument();
    expect(mockClient.submissions.move).toHaveBeenCalledWith(['a'], 't2');
    expect(onMoved).toHaveBeenCalledWith({ moved: [moved], refused: [] });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports 2 moved and 1 refused for "no room" as a normal outcome, not an error', async () => {
    slots({ t2: 2, t3: 5 });
    const items = [view({ id: 'a', title: 'A' }), view({ id: 'b', title: 'B' }), view({ id: 'c', title: 'C' })];
    mockClient.submissions.move.mockResolvedValue({
      moved: [view({ id: 'a', topicNodeId: 't2' }), view({ id: 'b', topicNodeId: 't2' })],
      refused: [{ id: 'c', reason: 'quota' }],
    });
    const onMoved = vi.fn();
    render(<MoveDialog submissions={items} onMoved={onMoved} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: t.heading(3) })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`^Kata .*${t.freeSlots(2)}`) }));
    expect(screen.getByText(t.fewerSlots(2, 3))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.submit }));

    const report = await screen.findByRole('status');
    expect(report).toHaveTextContent(t.resultMoved(2, 'Kata'));
    expect(report).toHaveTextContent(t.refusedHeading(1));
    expect(report).toHaveTextContent(t.refusedItem('C', t.reasons.quota));
    expect(mockClient.submissions.move).toHaveBeenCalledWith(['a', 'b', 'c'], 't2');
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('translates every refusal reason', async () => {
    slots({ t2: 5 });
    mockClient.submissions.move.mockResolvedValue({
      moved: [],
      refused: [
        { id: 'a', reason: 'not_ready' },
        { id: 'b', reason: 'same_topic' },
        { id: 'c', reason: 'not_found' },
      ],
    });
    const onMoved = vi.fn();
    render(
      <MoveDialog
        submissions={[view({ id: 'a', title: 'A' }), view({ id: 'b', title: 'B' }), view({ id: 'c', title: 'C' })]}
        onMoved={onMoved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('radio', { name: /^Kata / }));
    fireEvent.click(screen.getByRole('button', { name: t.submit }));

    const report = await screen.findByRole('status');
    expect(report).toHaveTextContent(t.resultNoneMoved);
    expect(report).toHaveTextContent(t.refusedItem('A', t.reasons.not_ready));
    expect(report).toHaveTextContent(t.refusedItem('B', t.reasons.same_topic));
    expect(report).toHaveTextContent(t.refusedItem('C', t.reasons.not_found));
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('asks for a target first, and explains a target that stopped being readable', async () => {
    slots({ t2: 5, t3: 5 });
    mockClient.submissions.move.mockRejectedValue(new SubmissionsApiError('NotFound', 404, 'Not found.'));
    render(<MoveDialog submissions={[view({ id: 'a' })]} onMoved={vi.fn()} onClose={vi.fn()} />);

    await screen.findAllByText(t.freeSlots(5));
    fireEvent.click(screen.getByRole('button', { name: t.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(t.chooseTarget);

    fireEvent.click(screen.getByRole('radio', { name: /^Kata / }));
    fireEvent.click(screen.getByRole('button', { name: t.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.targetNotFound);
    expect(screen.queryByRole('radio', { name: /^Kata / })).not.toBeInTheDocument();
  });

  it('filters the picker by title', async () => {
    slots({ t2: 5, t3: 5 });
    render(<MoveDialog submissions={[view({ id: 'a' })]} onMoved={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText(t.freeSlots(5));
    fireEvent.change(screen.getByLabelText(t.filterLabel), { target: { value: 'heian' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(t.filterLabel), { target: { value: 'zzz' } });
    expect(screen.getByText(t.noMatch)).toBeInTheDocument();
  });
});
