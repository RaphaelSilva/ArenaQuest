import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CatalogSidebar } from '../CatalogSidebar';
import type { TopicNode } from '@web/lib/topics-api';

// Mock Next.js hooks and Link
vi.mock('next/navigation', () => ({
  usePathname: () => '/catalog/1',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

describe('CatalogSidebar', () => {
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

  it('renders root topics', () => {
    render(<CatalogSidebar topics={mockTopics} />);
    expect(screen.getByText('Root Topic')).toBeInTheDocument();
  });

  it('initially expands all nodes (or at least roots to show children)', () => {
    // Our implementation expands all by default
    render(<CatalogSidebar topics={mockTopics} />);
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
  });

  it('collapses and expands children on button click', async () => {
    const user = userEvent.setup();
    render(<CatalogSidebar topics={mockTopics} />);
    
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
    
    // Find the toggle button (it's the first button)
    const toggleBtn = screen.getByRole('button', { name: 'Collapse' });
    await user.click(toggleBtn);
    
    expect(screen.queryByText('Child Topic')).not.toBeInTheDocument();
    
    const expandBtn = screen.getByRole('button', { name: 'Expand' });
    await user.click(expandBtn);
    
    expect(screen.getByText('Child Topic')).toBeInTheDocument();
  });
});
