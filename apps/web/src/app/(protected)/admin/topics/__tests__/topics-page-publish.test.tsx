/**
 * The topic status control follows the session's role (M28 Task 08): a session
 * without `admin` is never offered "Published", a content creator can still edit
 * a published topic's other fields without re-sending its status (Task 07's gate
 * refuses any body carrying `published` from a creator, even unchanged), and an
 * API refusal is shown inline with the form values kept.
 *
 * The create modal takes only a title — a new topic is always a `draft` — so
 * there is no publish option on create to hide; these tests cover the editor.
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

// Toggled per test: `true` renders as an admin, `false` as a content creator
// (the page's access check, `useHasRole(ADMIN, CONTENT_CREATOR)`, stays true).
const session = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: (...roles: string[]) =>
    roles.length === 1 && roles[0] === 'admin' ? session.isAdmin : true,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  // A stable object: the page keys its data effects on the client identity.
  return { ...actual, useApiClient: () => client };
});

import AdminTopicsPage from '../page';

const d = dictEn.admin.topics.detail;

const DRAFT: TopicNode = {
  id: 'topic-1',
  parentId: null,
  title: 'Kata',
  content: '',
  status: 'draft',
  visibility: 'restricted',
  archived: false,
  order: 0,
  estimatedMinutes: 10,
  tags: [],
  prerequisiteIds: [],
};

const PUBLISHED: TopicNode = { ...DRAFT, status: 'published' };

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
  return screen.findByLabelText(d.statusLabel) as Promise<HTMLSelectElement>;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

describe('AdminTopicsPage — publish controls follow the role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.isAdmin = true;
    client.adminTopics.list.mockResolvedValue([DRAFT]);
    client.adminTopics.update.mockResolvedValue(DRAFT);
    client.adminTags.list.mockResolvedValue([]);
    client.adminMedia.list.mockResolvedValue([]);
  });

  it('a content creator opening a draft is not offered "Published" and sees why', async () => {
    session.isAdmin = false;
    const user = userEvent.setup();
    const select = await openTopic(user);

    expect(optionValues(select)).toEqual(['draft', 'archived']);
    expect(screen.queryByRole('option', { name: d.statusPublished })).toBeNull();
    expect(screen.getByText(d.publishAdminOnly)).toBeInTheDocument();
  });

  it('a content creator opening a published topic sees its real status and saves a rename without `status`', async () => {
    session.isAdmin = false;
    client.adminTopics.list.mockResolvedValue([PUBLISHED]);
    client.adminTopics.update.mockResolvedValue(PUBLISHED);
    const user = userEvent.setup();
    const select = await openTopic(user);

    expect(select.value).toBe('published');
    expect(optionValues(select)).toEqual(['draft', 'published', 'archived']);

    const title = screen.getByLabelText(d.titleLabel);
    await user.clear(title);
    await user.type(title, 'Kata renamed');
    await user.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(client.adminTopics.update).toHaveBeenCalledTimes(1));
    const [id, body] = client.adminTopics.update.mock.calls[0];
    expect(id).toBe('topic-1');
    expect(body.title).toBe('Kata renamed');
    expect(body).not.toHaveProperty('status');
  });

  it('a content creator can still move a published topic back to draft', async () => {
    session.isAdmin = false;
    client.adminTopics.list.mockResolvedValue([PUBLISHED]);
    client.adminTopics.update.mockResolvedValue(DRAFT);
    const user = userEvent.setup();
    const select = await openTopic(user);

    await user.selectOptions(select, 'draft');
    await user.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(client.adminTopics.update).toHaveBeenCalledTimes(1));
    expect(client.adminTopics.update.mock.calls[0][1].status).toBe('draft');
  });

  it('an admin is offered "Published" and saving it sends that status', async () => {
    client.adminTopics.update.mockResolvedValue(PUBLISHED);
    const user = userEvent.setup();
    const select = await openTopic(user);

    expect(optionValues(select)).toEqual(['draft', 'published', 'archived']);
    expect(screen.queryByText(d.publishAdminOnly)).toBeNull();

    await user.selectOptions(select, 'published');
    await user.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(client.adminTopics.update).toHaveBeenCalledTimes(1));
    const [id, body] = client.adminTopics.update.mock.calls[0];
    expect(id).toBe('topic-1');
    expect(body.status).toBe('published');
  });

  it('an API refusal on publish is shown inline with the message and the form values kept', async () => {
    client.adminTopics.update.mockRejectedValue(new Error('Forbidden'));
    const user = userEvent.setup();
    const select = await openTopic(user);

    const title = screen.getByLabelText(d.titleLabel);
    await user.clear(title);
    await user.type(title, 'Kata edited');
    await user.selectOptions(select, 'published');
    await user.click(screen.getByRole('button', { name: d.saveButton }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(d.publishForbidden('Forbidden'));
    expect(alert).toHaveTextContent('Forbidden');
    expect((screen.getByLabelText(d.titleLabel) as HTMLInputElement).value).toBe('Kata edited');
    expect(select.value).toBe('published');
  });

  it('a refusal on a save that did not attempt to publish shows the plain API message', async () => {
    client.adminTopics.update.mockRejectedValue(new Error('Forbidden'));
    const user = userEvent.setup();
    await openTopic(user);

    await user.click(screen.getByRole('button', { name: d.saveButton }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Forbidden');
    expect(alert).not.toHaveTextContent(d.publishForbidden('Forbidden'));
  });
});
