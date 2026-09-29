/**
 * The topic editor tags a topic by name: an existing topic's tags pre-fill the
 * combobox as chips, and saving sends `tags` (names) — never `tagIds`, never a
 * tag ID.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { TopicNode } from '@web/lib/admin-topics-api';

const client = vi.hoisted(() => ({
  adminTopics: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    archive: vi.fn(),
  },
  adminTags: { list: vi.fn() },
  adminMedia: {
    list: vi.fn(),
    getPresignedUrl: vi.fn(),
    finalize: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => true,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  // A stable object: the page keys its data effects on the client identity.
  return { ...actual, useApiClient: () => client };
});

import AdminTopicsPage from '../page';

const d = dictEn.admin.topics.detail;

const TOPIC: TopicNode = {
  id: 'topic-1',
  parentId: null,
  title: 'Kata',
  content: '',
  status: 'draft',
  visibility: 'restricted',
  archived: false,
  order: 0,
  estimatedMinutes: 10,
  tags: [
    { id: 'tag-uuid-chudan', name: 'Chūdan', slug: 'chudan' },
    { id: 'tag-uuid-jodan', name: 'Jōdan', slug: 'jodan' },
  ],
  prerequisiteIds: [],
};

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminTopicsPage />
    </DictProvider>,
  );
}

async function openTopic(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  await user.click(await screen.findByTestId('topic-node-topic-1'));
  await screen.findByRole('combobox', { name: d.tagsLabel });
}

describe('AdminTopicsPage — tags by name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.adminTopics.list.mockResolvedValue([TOPIC]);
    client.adminTopics.update.mockResolvedValue(TOPIC);
    client.adminTags.list.mockResolvedValue([]);
    client.adminMedia.list.mockResolvedValue([]);
  });

  it('opening an existing topic shows its current tags as chips', async () => {
    const user = userEvent.setup();
    await openTopic(user);

    expect(screen.getByRole('button', { name: d.tagRemoveAriaLabel('Chūdan') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.tagRemoveAriaLabel('Jōdan') })).toBeInTheDocument();
    expect(screen.queryByText('tag-uuid-chudan')).toBeNull();
  });

  it('removing a chip and saving sends tags without it, and never tagIds', async () => {
    const user = userEvent.setup();
    await openTopic(user);

    await user.click(screen.getByRole('button', { name: d.tagRemoveAriaLabel('Chūdan') }));
    await user.type(screen.getByRole('combobox', { name: d.tagsLabel }), 'Kihon novo{Enter}');
    await user.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(client.adminTopics.update).toHaveBeenCalledTimes(1));
    const [id, body] = client.adminTopics.update.mock.calls[0];
    expect(id).toBe('topic-1');
    expect(body.tags).toEqual(['Jōdan', 'Kihon novo']);
    expect(body).not.toHaveProperty('tagIds');
    expect(JSON.stringify(body)).not.toContain('tag-uuid-');
  });

  it('the tag search queries the admin tags API', async () => {
    const user = userEvent.setup();
    await openTopic(user);

    await user.type(screen.getByRole('combobox', { name: d.tagsLabel }), 'chu');
    await waitFor(() => expect(client.adminTags.list).toHaveBeenCalledWith({ q: 'chu', limit: 10 }));
  });
});
