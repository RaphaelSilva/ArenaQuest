import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import type { TopicNode, TopicProgressStatus } from '@web/lib/topics-api';

const mockReplace = vi.fn();
let mockPathname = '/catalog';
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Any call to the topics API from the sidebar would show up here.
const mockTopicsList = vi.fn();
vi.mock('@web/lib/topics-api', () => ({
  createTopicsApi: () => ({ list: mockTopicsList }),
}));

import { CatalogSidebar } from '../CatalogSidebar';
import { MobileSearchBar } from '../MobileSearchBar';

const SOCO = { id: 't-soco', name: 'Soco', slug: 'soco' };
const FAIXA = { id: 't-faixa', name: 'Faixa Amarela', slug: 'faixa-amarela' };
const KIHON = { id: 't-kihon', name: 'Kihon', slug: 'kihon' };

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
    media: [],
    ...over,
  };
}

// karate (root) → tsuki (tagged Soco) → drill (untagged)
// kata (root, untagged) → basica (untagged)
const TOPICS: TopicNode[] = [
  makeNode({ id: 'karate', title: 'Karatê', order: 1 }),
  makeNode({ id: 'tsuki', parentId: 'karate', title: 'Oi Tsuki', tags: [SOCO] }),
  makeNode({ id: 'drill', parentId: 'tsuki', title: 'Exercício de base' }),
  makeNode({ id: 'kata', title: 'Kata', order: 2 }),
  makeNode({ id: 'basica', parentId: 'kata', title: 'Kata Básica' }),
  makeNode({ id: 'multi', parentId: 'kata', title: 'Heian Shodan', tags: [SOCO, FAIXA, KIHON], order: 3 }),
];

const sidebar = dictPt.catalog.sidebar;

function renderSidebar(topics: TopicNode[] = TOPICS) {
  return render(
    <CatalogSidebar
      topics={topics}
      progressMap={new Map<string, TopicProgressStatus>()}
      globalProgress={0}
      isInstructor={false}
    />,
  );
}

/** The tree row (the element wrapping the title) for a given topic title. */
function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest('div.relative') as HTMLElement;
}

describe('CatalogSidebar — tag search', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockTopicsList.mockClear();
    mockPathname = '/catalog';
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a topic matched only by a tag renders its chip', () => {
    mockSearchParams = new URLSearchParams('q=soco');
    renderSidebar();
    expect(within(rowOf('Oi Tsuki')).getByText('Soco')).toBeInTheDocument();
  });

  it('a topic matched by title renders no chip', () => {
    mockSearchParams = new URLSearchParams('q=tsuki');
    renderSidebar();
    expect(within(rowOf('Oi Tsuki')).queryByText('Soco')).not.toBeInTheDocument();
  });

  it('shows at most two chips, then a +n overflow', () => {
    // Three tag-only terms → three contributing tags on "Heian Shodan".
    mockSearchParams = new URLSearchParams('q=%23soco %23faixa-amarela %23kihon');
    renderSidebar();
    const row = rowOf('Heian Shodan');
    expect(within(row).getByText('Soco')).toBeInTheDocument();
    expect(within(row).getByText('Faixa Amarela')).toBeInTheDocument();
    expect(within(row).queryByText('Kihon')).not.toBeInTheDocument();
    expect(within(row).getByText(sidebar.moreTags(1))).toBeInTheDocument();
  });

  it('?tag=soco shows the tagged topic and its ancestors, hides an untagged sibling root, and renders untagged children without a chip', () => {
    mockSearchParams = new URLSearchParams('tag=soco&open=karate,tsuki');
    renderSidebar(TOPICS.filter((t) => t.id !== 'multi'));
    expect(screen.getByText('Karatê')).toBeInTheDocument();
    expect(screen.getByText('Oi Tsuki')).toBeInTheDocument();
    expect(within(rowOf('Oi Tsuki')).getByText('Soco')).toBeInTheDocument();
    // Untagged child of the matched topic still renders, with no chip.
    expect(screen.getByText('Exercício de base')).toBeInTheDocument();
    expect(within(rowOf('Exercício de base')).queryByText('Soco')).not.toBeInTheDocument();
    // Untagged sibling root is hidden.
    expect(screen.queryByText('Kata')).not.toBeInTheDocument();
    expect(screen.queryByText('Kata Básica')).not.toBeInTheDocument();
  });

  it('?tag= auto-expands the ancestors of the tagged topic', () => {
    mockSearchParams = new URLSearchParams('tag=soco&open=none');
    renderSidebar(TOPICS.filter((t) => t.id !== 'multi'));
    expect(screen.getByText('Oi Tsuki')).toBeInTheDocument();
  });

  it('renders the active-tag chip with the tag’s own name', () => {
    mockSearchParams = new URLSearchParams('tag=soco');
    renderSidebar();
    expect(screen.getByText(sidebar.activeTag('Soco'))).toBeInTheDocument();
  });

  it('dismissing the active-tag chip removes `tag` from the URL and keeps `q`', () => {
    mockSearchParams = new URLSearchParams('q=tsuki&tag=soco&open=karate');
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: sidebar.clearTag }));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = new URL(mockReplace.mock.calls[0][0] as string, 'http://x');
    expect(url.searchParams.get('tag')).toBeNull();
    expect(url.searchParams.get('q')).toBe('tsuki');
    expect(url.searchParams.get('open')).toBe('karate');
  });

  it('typing keeps `tag` in the URL', () => {
    vi.useFakeTimers();
    mockSearchParams = new URLSearchParams('tag=soco');
    renderSidebar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'oi' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const url = new URL(mockReplace.mock.calls.at(-1)![0] as string, 'http://x');
    expect(url.searchParams.get('tag')).toBe('soco');
    expect(url.searchParams.get('q')).toBe('oi');
  });

  it('typing in the search box triggers no additional topics.list() call', () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderSidebar();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'soco' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(mockReplace).toHaveBeenCalled();
    expect(mockTopicsList).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the new placeholder', () => {
    renderSidebar();
    expect(screen.getByPlaceholderText(sidebar.searchPlaceholder)).toBeInTheDocument();
  });
});

describe('MobileSearchBar — clearing', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPathname = '/catalog';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clearing the input removes both `q` and `tag`', () => {
    vi.useFakeTimers();
    mockSearchParams = new URLSearchParams('q=soco&tag=soco&open=karate');
    render(<MobileSearchBar />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const url = new URL(mockReplace.mock.calls.at(-1)![0] as string, 'http://x');
    expect(url.searchParams.get('q')).toBeNull();
    expect(url.searchParams.get('tag')).toBeNull();
    expect(url.searchParams.get('open')).toBe('karate');
  });

  it('typing keeps `tag`', () => {
    vi.useFakeTimers();
    mockSearchParams = new URLSearchParams('tag=soco');
    render(<MobileSearchBar />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'oi' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const url = new URL(mockReplace.mock.calls.at(-1)![0] as string, 'http://x');
    expect(url.searchParams.get('q')).toBe('oi');
    expect(url.searchParams.get('tag')).toBe('soco');
  });
});
