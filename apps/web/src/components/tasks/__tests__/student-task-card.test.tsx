import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { StudentTaskCard } from '../student-task-card';

describe('StudentTaskCard', () => {
  it('links to the detail page and shows counts (plural)', () => {
    render(
      <StudentTaskCard
        task={{ id: 'abc', title: 'Demo', stageCount: 3, topicCount: 2, updatedAt: '' }}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/tasks/abc');
    expect(screen.getByText(`${dictPt.tasks.card.stageCount(3)} · ${dictPt.tasks.card.topicCount(2)}`)).toBeInTheDocument();
  });

  it('uses singular labels for counts of 1', () => {
    render(
      <StudentTaskCard
        task={{ id: 'a', title: 'Solo', stageCount: 1, topicCount: 1, updatedAt: '' }}
      />,
    );
    expect(screen.getByText(`${dictPt.tasks.card.stageCount(1)} · ${dictPt.tasks.card.topicCount(1)}`)).toBeInTheDocument();
  });
});
