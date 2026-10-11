import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { TopicTreePicker } from '../TopicTreePicker';

const d = dictEn.admin.missions.requirements;

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

// Listed out of order on purpose: the picker sorts by `order`, then title.
const TOPICS: TopicNode[] = [
  topic('m2', 'Module 2', { order: 1 }),
  topic('l22', 'Lesson 2.2', { parentId: 'm2', order: 1 }),
  topic('l221', 'Gedan Barai', { parentId: 'l22', order: 0 }),
  topic('l21', 'Lesson 2.1', { parentId: 'm2', order: 0 }),
  topic('l211', 'Heian Shodan', { parentId: 'l21', order: 0 }),
  topic('m1', 'Module 1', { order: 0 }),
  topic('l11', 'Lesson 1.1', { parentId: 'm1', order: 1 }),
  topic('l10', 'Lesson 1.0', { parentId: 'm1', order: 0 }),
  topic('bravo', 'Bravo', { parentId: 'm1', order: 2 }),
  topic('alpha', 'Alpha', { parentId: 'm1', order: 2 }),
  topic('dl', 'Draft lesson', { parentId: 'm1', order: 3, status: 'draft' }),
  topic('al', 'Archived lesson', { parentId: 'm2', order: 2, archived: true }),
  topic('sl', 'Status-archived lesson', { parentId: 'm2', order: 3, status: 'archived' }),
  topic('dm', 'Draft module', { order: 2, status: 'draft' }),
  topic('gem', 'Hidden gem', { parentId: 'dm', order: 0 }),
  topic('dead', 'Draft leaf root', { order: 3, status: 'draft' }),
];

type HarnessProps = {
  topics?: TopicNode[];
  initial?: string;
  disabled?: boolean;
  onChange?: (id: string) => void;
};

function Harness({ topics = TOPICS, initial = '', disabled, onChange }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <TopicTreePicker
      topics={topics}
      value={value}
      disabled={disabled}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

function renderPicker(props: HarnessProps = {}) {
  return render(
    <DictProvider value={dictEn}>
      <Harness {...props} />
    </DictProvider>,
  );
}

const rowTitles = () =>
  screen.getAllByTestId('topic-tree-row').map((row) => ({
    title: row.querySelector('.truncate')?.textContent,
    depth: Number(row.getAttribute('data-depth')),
  }));

const expandButton = (title: string) => screen.getByRole('button', { name: d.topicExpand(title) });
const collapseButton = (title: string) => screen.getByRole('button', { name: d.topicCollapse(title) });

describe('TopicTreePicker', () => {
  it('nests by parent and orders by order then title, roots expanded and deeper modules collapsed', () => {
    renderPicker();
    expect(screen.getByRole('radiogroup', { name: d.fields.topic })).toBeInTheDocument();
    expect(rowTitles()).toEqual([
      { title: 'Module 1', depth: 0 },
      { title: 'Lesson 1.0', depth: 1 },
      { title: 'Lesson 1.1', depth: 1 },
      { title: 'Alpha', depth: 1 },
      { title: 'Bravo', depth: 1 },
      { title: 'Module 2', depth: 0 },
      { title: 'Lesson 2.1', depth: 1 },
      { title: 'Lesson 2.2', depth: 1 },
      { title: 'Draft module', depth: 0 },
      { title: 'Hidden gem', depth: 1 },
    ]);
    expect(collapseButton('Module 1')).toHaveAttribute('aria-expanded', 'true');
    expect(expandButton('Lesson 2.1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radio', { name: 'Heian Shodan' })).not.toBeInTheDocument();
    // Leaves and modules both carry a radio.
    expect(screen.getByRole('radio', { name: 'Module 2' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Lesson 1.0' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('hides drafts and archived topics, keeping a draft ancestor of a published topic as a label', () => {
    renderPicker();
    expect(screen.queryByText('Draft lesson')).not.toBeInTheDocument();
    expect(screen.queryByText('Archived lesson')).not.toBeInTheDocument();
    expect(screen.queryByText('Status-archived lesson')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft leaf root')).not.toBeInTheDocument();
    // The draft module is shown so its published lesson stays reachable, but cannot be picked.
    expect(screen.getByText('Draft module')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Draft module/ })).not.toBeInTheDocument();
    expect(screen.getByText(d.topicUnpublished)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Hidden gem' })).toBeInTheDocument();
  });

  it('starts with the ancestors of the value expanded and their siblings collapsed', () => {
    renderPicker({ initial: 'l211' });
    expect(collapseButton('Module 2')).toHaveAttribute('aria-expanded', 'true');
    expect(collapseButton('Lesson 2.1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toHaveAttribute('aria-checked', 'true');
    expect(expandButton('Lesson 2.2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Gedan Barai')).not.toBeInTheDocument();
    expect(screen.getByText(d.topicSelected('Module 2 › Lesson 2.1 › Heian Shodan'))).toBeInTheDocument();
    // The picked radio is the group's tab stop.
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Module 1' })).toHaveAttribute('tabindex', '-1');
  });

  it('expands and collapses a module by click', () => {
    renderPicker();
    fireEvent.click(expandButton('Lesson 2.1'));
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toBeInTheDocument();
    expect(collapseButton('Lesson 2.1')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapseButton('Lesson 2.1'));
    expect(screen.queryByRole('radio', { name: 'Heian Shodan' })).not.toBeInTheDocument();
    // A root collapses too.
    fireEvent.click(collapseButton('Module 1'));
    expect(screen.queryByRole('radio', { name: 'Lesson 1.0' })).not.toBeInTheDocument();
  });

  it('expands and collapses by keyboard: Enter/Space on the chevron, arrows on the radio', async () => {
    const user = userEvent.setup();
    renderPicker();
    expandButton('Lesson 2.1').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toBeInTheDocument();
    expect(collapseButton('Lesson 2.1')).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.queryByRole('radio', { name: 'Heian Shodan' })).not.toBeInTheDocument();

    const radio = screen.getByRole('radio', { name: 'Lesson 2.2' });
    fireEvent.keyDown(radio, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Gedan Barai' })).toBeInTheDocument();
    fireEvent.keyDown(radio, { key: 'ArrowLeft' });
    expect(screen.queryByRole('radio', { name: 'Gedan Barai' })).not.toBeInTheDocument();

    // Arrows move between radios, skipping the non-selectable label.
    fireEvent.keyDown(radio, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Hidden gem' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Hidden gem' }), { key: 'ArrowUp' });
    expect(radio).toHaveFocus();
  });

  it('filters by search, keeping the path to each match open, and says when nothing matches', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText(d.topicSearchLabel), { target: { value: 'heián' } });
    expect(screen.getByPlaceholderText(d.topicSearchPlaceholder)).toBeInTheDocument();
    expect(rowTitles()).toEqual([
      { title: 'Module 2', depth: 0 },
      { title: 'Lesson 2.1', depth: 1 },
      { title: 'Heian Shodan', depth: 2 },
    ]);

    fireEvent.change(screen.getByLabelText(d.topicSearchLabel), { target: { value: 'gem' } });
    expect(rowTitles().map((r) => r.title)).toEqual(['Draft module', 'Hidden gem']);

    fireEvent.change(screen.getByLabelText(d.topicSearchLabel), { target: { value: 'zzz' } });
    expect(screen.getByText(d.topicNoMatch)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(d.topicSearchLabel), { target: { value: '' } });
    expect(screen.getByRole('radio', { name: 'Module 1' })).toBeInTheDocument();
  });

  it('selects a leaf once, shows its full path, and keeps it when picked again', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    expect(screen.getByText(d.topicNone)).toBeInTheDocument();
    fireEvent.click(expandButton('Lesson 2.1'));
    fireEvent.click(screen.getByRole('radio', { name: 'Heian Shodan' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('l211');
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(d.topicSelected('Module 2 › Lesson 2.1 › Heian Shodan'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Heian Shodan' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toHaveAttribute('aria-checked', 'true');

    // Picking a module moves the single selection to it.
    fireEvent.click(screen.getByRole('radio', { name: 'Module 1' }));
    expect(onChange).toHaveBeenLastCalledWith('m1');
    expect(screen.getByRole('radio', { name: 'Heian Shodan' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(d.topicSelected('Module 1'))).toBeInTheDocument();
  });

  it('clears the selection', () => {
    const onChange = vi.fn();
    renderPicker({ initial: 'l10', onChange });
    fireEvent.click(screen.getByRole('button', { name: d.topicClear }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByText(d.topicNone)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.topicClear })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Lesson 1.0' })).toHaveAttribute('aria-checked', 'false');
  });

  it('renders only the selected path when disabled', () => {
    renderPicker({ initial: 'l211', disabled: true });
    expect(screen.getByText(d.topicSelected('Module 2 › Lesson 2.1 › Heian Shodan'))).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('names an unknown value and an empty topic list', () => {
    const { unmount } = renderPicker({ initial: 'gone' });
    expect(screen.getByText(d.topicSelected(d.topicUnknown))).toBeInTheDocument();
    unmount();
    renderPicker({ topics: [topic('x', 'Draft only', { status: 'draft' })] });
    expect(screen.getByText(d.topicsEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(within(document.body).queryByText('Draft only')).not.toBeInTheDocument();
  });
});
