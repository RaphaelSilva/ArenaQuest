import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogSidebar } from '../CatalogSidebar';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';

const mockReplace = vi.fn();

// Mock Next.js hooks and Link
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalog',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const mockTopics: TopicNode[] = [
  {
    id: '1',
    parentId: null,
    title: 'Root Topic',
    content: '',
    status: 'published',
    archived: false,
    order: 0,
    estimatedMinutes: 10,
    tags: [],
    prerequisiteIds: [],
  },
  {
    id: '2',
    parentId: '1',
    title: 'Child Topic',
    content: '',
    status: 'published',
    archived: false,
    order: 0,
    estimatedMinutes: 5,
    tags: [],
    prerequisiteIds: [],
  },
];

const emptyProgressMap = new Map<string, TopicProgressStatus>();

describe('CatalogSidebar', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    localStorage.clear();
  });

  it('renders root topics', () => {
    render(
      <CatalogSidebar
        topics={mockTopics}
        progressMap={emptyProgressMap}
        globalProgress={0}
        isInstructor={false}
      />,
    );
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
  });

  it('initially expands all nodes (or at least roots to show children)', () => {
    render(
      <CatalogSidebar
        topics={mockTopics}
        progressMap={emptyProgressMap}
        globalProgress={0}
        isInstructor={false}
      />,
    );
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
  });

  it('collapses and expands children on button click', async () => {
    const user = userEvent.setup();
    render(
      <CatalogSidebar
        topics={mockTopics}
        progressMap={emptyProgressMap}
        globalProgress={0}
        isInstructor={false}
      />,
    );

    expect(screen.getByText('Child Topic')).toBeInTheDocument();

    // Find the expand/collapse button (the div with role="button" and aria-expanded)
    const toggleBtn = screen.getByRole('button', { expanded: true });
    await user.click(toggleBtn);

    // URL should be updated (router.replace called)
    expect(mockReplace).toHaveBeenCalled();
  });
});
