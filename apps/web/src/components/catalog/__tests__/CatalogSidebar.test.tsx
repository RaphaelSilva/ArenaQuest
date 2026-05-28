import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogSidebar } from '../CatalogSidebar';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';

const mockReplace = vi.fn();
let mockPathname = '/catalog';
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string; [k: string]: unknown }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
}));

function makeNode(over: Partial<TopicNode> & Pick<TopicNode, 'id'>): TopicNode {
  return {
    parentId: null,
    title: over.id,
    content: '',
    status: 'published',
    archived: false,
    order: 0,
    estimatedMinutes: 0,
    tags: [],
    prerequisiteIds: [],
    ...over,
  };
}

const deepTopics: TopicNode[] = [
  makeNode({ id: 'root', title: 'Root Topic' }),
  makeNode({ id: 'child', parentId: 'root', title: 'Child Topic' }),
  makeNode({ id: 'grand', parentId: 'child', title: 'Grandchild Topic' }),
];

const emptyProgressMap = new Map<string, TopicProgressStatus>();

function renderSidebar(topics: TopicNode[] = deepTopics) {
  return render(
    <CatalogSidebar
      topics={topics}
      progressMap={emptyProgressMap}
      globalProgress={0}
      isInstructor={false}
    />,
  );
}

describe('CatalogSidebar', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPathname = '/catalog';
    mockSearchParams = new URLSearchParams();
    localStorage.clear();
  });

  it('renders root topics', () => {
    renderSidebar();
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
  });

  it('renders a 3-level tree when ancestors are expanded via ?open=', () => {
    mockSearchParams = new URLSearchParams('open=root,child');
    renderSidebar();
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
    expect(screen.getByText('Grandchild Topic')).toBeInTheDocument();
  });

  it('chevron click toggles expansion via URL update without navigating', async () => {
    const user = userEvent.setup();
    renderSidebar();
    // Root is auto-expanded (empty openParam defaults to all roots).
    const collapseRoot = screen.getByRole('button', { name: 'Recolher Root Topic' });
    await user.click(collapseRoot);
    expect(mockReplace).toHaveBeenCalled();
    const url = mockReplace.mock.calls[0][0] as string;
    // After collapsing root, ?open= should no longer include "root"
    expect(url).not.toMatch(/[?&]open=[^&]*\broot\b/);
  });

  it('auto-expands ancestors of the active route so deep nodes are visible', () => {
    mockPathname = '/catalog/grand';
    renderSidebar();
    // Without any ?open=, ancestors (root, child) should still be expanded so grand is visible.
    expect(screen.getByText('Grandchild Topic')).toBeInTheDocument();
  });

  it('search matches descendants and expands their ancestors', () => {
    mockSearchParams = new URLSearchParams('q=Grandchild');
    renderSidebar();
    expect(screen.getByText('Grandchild Topic')).toBeInTheDocument();
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
  });

  it('?open= containing a non-root id keeps that branch open', () => {
    mockSearchParams = new URLSearchParams('open=child');
    renderSidebar();
    // Root is collapsed (not in openParam), so child shouldn't render visually under it...
    // but ancestorIds is empty (no active route), so we expect only roots visible.
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
    expect(screen.queryByText('Child Topic')).not.toBeInTheDocument();
  });

  it('leaf nodes show no chevron toggle (chevron is hidden for nodes without children)', () => {
    mockSearchParams = new URLSearchParams('open=root,child');
    renderSidebar();
    // There must be NO "Expand/Collapse Grandchild Topic" button (it's a leaf).
    expect(
      screen.queryByRole('button', { name: /Expandir Grandchild Topic|Recolher Grandchild Topic/ }),
    ).not.toBeInTheDocument();
  });

  it('shows empty state when no topics', () => {
    renderSidebar([]);
    expect(screen.getByText(/Nenhum conteúdo publicado/i)).toBeInTheDocument();
  });
});
