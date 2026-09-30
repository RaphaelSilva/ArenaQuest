import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { TopicWithMedia } from '@web/lib/topics-api';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { TopicHeader } from '../TopicHeader';

function makeTopic(tags?: { id: string; name: string; slug: string }[]): TopicWithMedia {
  return {
    id: 't1',
    parentId: null,
    title: 'Kihon',
    content: '',
    status: 'published',
    sortOrder: 0,
    children: [],
    media: [],
    tags,
  } as unknown as TopicWithMedia;
}

const label = dictPt.catalog.redesign.topicTagsLabel;

describe('TopicHeader tags', () => {
  it('renders one link per tag to the catalog tag filter', () => {
    render(
      <TopicHeader
        topic={makeTopic([
          { id: 'a', name: 'Soco', slug: 'soco' },
          { id: 'b', name: 'Kihon', slug: 'kihon' },
        ])}
        trail={[]}
        totalInBranch={0}
      />,
    );
    const list = screen.getByRole('list', { name: label });
    const links = list.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Soco' })).toHaveAttribute('href', '/catalog?tag=soco');
    expect(screen.getByRole('link', { name: 'Kihon' })).toHaveAttribute('href', '/catalog?tag=kihon');
  });

  it('renders no list for empty or missing tags', () => {
    const { rerender } = render(<TopicHeader topic={makeTopic([])} trail={[]} totalInBranch={0} />);
    expect(screen.queryByRole('list', { name: label })).toBeNull();
    rerender(<TopicHeader topic={makeTopic(undefined)} trail={[]} totalInBranch={0} />);
    expect(screen.queryByRole('list', { name: label })).toBeNull();
  });
});
