import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/navigation
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/catalog',
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { CatalogSidebar } from '../CatalogSidebar';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';

const TOPICS: TopicNode[] = [
  {
    id: 'root1',
    parentId: null,
    title: 'Fundamentos do Movimento',
    content: '',
    status: 'published',
    archived: false,
    order: 1,
    estimatedMinutes: 30,
    tags: [],
    prerequisiteIds: [],
  },
  {
    id: 'child1',
    parentId: 'root1',
    title: 'Postura e alinhamento',
    content: 'Princípios de posicionamento corporal.',
    status: 'published',
    archived: false,
    order: 1,
    estimatedMinutes: 10,
    tags: [],
    prerequisiteIds: [],
  },
  {
    id: 'child2',
    parentId: 'root1',
    title: 'Padrão de respiração',
    content: 'Técnicas de respiração diafragmática.',
    status: 'published',
    archived: false,
    order: 2,
    estimatedMinutes: 10,
    tags: [],
    prerequisiteIds: [],
  },
  {
    id: 'root2',
    parentId: null,
    title: 'Força e Potência',
    content: '',
    status: 'published',
    archived: false,
    order: 2,
    estimatedMinutes: 60,
    tags: [],
    prerequisiteIds: [],
  },
];

const PROGRESS_MAP = new Map<string, TopicProgressStatus>([
  ['child1', 'completed'],
  ['child2', 'in_progress'],
]);

function renderSidebar(overrides?: Partial<React.ComponentProps<typeof CatalogSidebar>>) {
  return render(
    <CatalogSidebar
      topics={TOPICS}
      progressMap={PROGRESS_MAP}
      globalProgress={50}
      isInstructor={false}
      {...overrides}
    />,
  );
}

describe('CatalogSidebar', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    localStorage.clear();
  });

  it('renders root topics', () => {
    renderSidebar();
    expect(screen.getByText('Fundamentos do Movimento')).toBeInTheDocument();
    expect(screen.getByText('Força e Potência')).toBeInTheDocument();
  });

  it('expands and shows subtopics when topic is clicked', () => {
    renderSidebar();
    // By default all root topics are expanded (openParam is empty → defaults to all open)
    expect(screen.getByText('Postura e alinhamento')).toBeInTheDocument();
    expect(screen.getByText('Padrão de respiração')).toBeInTheDocument();
  });

  it('collapses subtopics when topic is clicked and URL is updated', () => {
    renderSidebar();
    // Find the topic row by its aria-expanded attribute (it's the first root topic row)
    const topicRows = screen.getAllByRole('button');
    const rootRow = topicRows.find((el) => el.getAttribute('aria-expanded') !== null);
    expect(rootRow).toBeTruthy();
    fireEvent.click(rootRow!);
    // Should call router.replace to update URL with new open state
    expect(mockReplace).toHaveBeenCalled();
    const call = mockReplace.mock.calls[0][0] as string;
    // root1 should be excluded from open param after collapsing
    expect(call).not.toContain('root1');
  });

  it('search filters topics by name', () => {
    renderSidebar();
    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'Força' } });
    // After search value changes, visible filter should narrow
    expect(screen.getByDisplayValue('Força')).toBeInTheDocument();
  });

  it('shows role pill when isInstructor is true', () => {
    renderSidebar({ isInstructor: true });
    expect(screen.getByText('Participante')).toBeInTheDocument();
    expect(screen.getByText('Instrutor')).toBeInTheDocument();
  });

  it('hides role pill for participants', () => {
    renderSidebar({ isInstructor: false });
    expect(screen.queryByText('Participante')).not.toBeInTheDocument();
    expect(screen.queryByText('Instrutor')).not.toBeInTheDocument();
  });

  it('shows global progress', () => {
    renderSidebar({ globalProgress: 75 });
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows empty state when no topics', () => {
    renderSidebar({ topics: [] });
    expect(screen.getByText('No published content yet.')).toBeInTheDocument();
  });
});
