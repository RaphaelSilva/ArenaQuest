import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StudentTaskDetail } from '../student-task-detail';
import type { PublicTaskDetail } from '@web/lib/tasks-api';

function makeTask(overrides: Partial<PublicTaskDetail> = {}): PublicTaskDetail {
  return {
    id: 't1',
    title: 'Passe de bola',
    description: '# Welcome\n\n**Bold** content.',
    updatedAt: '2026-05-01T00:00:00Z',
    stages: [
      {
        id: 's1',
        label: 'Reading',
        order: 0,
        topics: [{ id: 'top1', title: 'Fundamentos' }],
      },
      { id: 's2', label: 'Practice', order: 1, topics: [] },
    ],
    ...overrides,
  };
}

describe('StudentTaskDetail', () => {
  it('renders title, sanitized markdown, and stages', () => {
    render(<StudentTaskDetail task={makeTask()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Passe de bola' })).toBeInTheDocument();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Reading')).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();
  });

  it('uses ordered list semantics for stages', () => {
    const { container } = render(<StudentTaskDetail task={makeTask()} />);
    expect(container.querySelector('ol[data-testid="stages-list"]')).not.toBeNull();
  });

  it('renders topic chips as catalog links', () => {
    render(<StudentTaskDetail task={makeTask()} />);
    const chip = screen.getByRole('link', { name: 'Fundamentos' });
    expect(chip).toHaveAttribute('href', '/catalog/top1');
  });

  it('sanitizes script tags inside the description', () => {
    const { container } = render(
      <StudentTaskDetail
        task={makeTask({ description: '# Hi\n\n<script>alert(1)</script>' })}
      />,
    );
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).not.toContain('alert(1)');
  });

  it('shows no-stage placeholder when stages list is empty', () => {
    render(<StudentTaskDetail task={makeTask({ stages: [] })} />);
    expect(screen.getByText(/No stages yet/i)).toBeInTheDocument();
  });
});
