import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskTopicPicker } from '../task-topic-picker';
import type { TopicNode } from '@web/lib/admin-topics-api';

function topic(id: string, status: TopicNode['status'], archived = false): TopicNode {
  return {
    id,
    parentId: null,
    title: `Topic ${id}`,
    content: '',
    status,
    archived,
    order: 0,
    estimatedMinutes: 0,
    tags: [],
    prerequisiteIds: [],
  };
}

describe('TaskTopicPicker', () => {
  it('hides drafts when allowDrafts=false', () => {
    render(
      <TaskTopicPicker
        topics={[topic('a', 'published'), topic('b', 'draft')]}
        allowDrafts={false}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Topic a')).toBeInTheDocument();
    expect(screen.queryByText('Topic b')).not.toBeInTheDocument();
  });

  it('shows drafts when allowDrafts=true', () => {
    render(
      <TaskTopicPicker
        topics={[topic('a', 'published'), topic('b', 'draft')]}
        allowDrafts={true}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Topic b')).toBeInTheDocument();
  });

  it('hides archived topics regardless of allowDrafts', () => {
    render(
      <TaskTopicPicker
        topics={[topic('a', 'archived', true)]}
        allowDrafts={true}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Topic a')).not.toBeInTheDocument();
  });

  it('toggles selection on click', () => {
    const onChange = vi.fn();
    render(
      <TaskTopicPicker
        topics={[topic('a', 'published')]}
        allowDrafts={false}
        selected={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('un-toggles when already selected', () => {
    const onChange = vi.fn();
    render(
      <TaskTopicPicker
        topics={[topic('a', 'published')]}
        allowDrafts={false}
        selected={['a']}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
