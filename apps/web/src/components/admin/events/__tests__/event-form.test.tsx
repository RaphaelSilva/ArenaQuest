/**
 * The admin event form — the behaviours that carry milestone decisions.
 *
 * These are not coverage for the sake of it: each case here is a rule that was
 * argued about and could regress silently. The payload shape, the audience
 * pickers appearing only where they mean something, the message prefill that
 * must never overwrite a human, the publish control a `content_creator` cannot
 * use, and the delete control that must not exist at all.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n';
import type { AdminEvent } from '@web/lib/admin-events-api';
import { AdminEventsApiError } from '@web/lib/admin-events-api';

const d = dictPt.admin.events;

// The tenant number the contact field starts from. `brand` reads the env var at
// module scope, so it is stubbed here rather than through `vi.stubEnv`.
vi.mock('@web/lib/brand', () => ({
  brand: { whatsapp: '5519999991155' },
}));

const mockAdminEvents = vi.hoisted(() => ({
  list: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replaceAudience: vi.fn(),
  presignFlyer: vi.fn(),
  finalizeFlyer: vi.fn(),
  deleteFlyer: vi.fn(),
}));
const mockAdminGroups = vi.hoisted(() => ({ list: vi.fn() }));
const mockAdminUsers = vi.hoisted(() => ({ list: vi.fn() }));

// One stable object, as the real `useApiClient` returns: a fresh one per render
// would invalidate every `useCallback`/`useMemo` keyed on the client.
const mockClient = {
  adminEvents: mockAdminEvents,
  adminGroups: mockAdminGroups,
  adminUsers: mockAdminUsers,
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { EventForm } from '@web/components/admin/events/EventForm';
import { DictProvider } from '@web/context/dict-context';

function renderForm(props: Partial<React.ComponentProps<typeof EventForm>> = {}) {
  return render(
    <DictProvider value={dictPt}>
      <EventForm
        event={null}
        canPublish
        onCreated={props.onCreated ?? vi.fn()}
        onReload={props.onReload ?? vi.fn()}
        {...props}
      />
    </DictProvider>,
  );
}

function makeEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'event-1',
    slug: 'seminario-de-outubro',
    title: 'Seminário de outubro',
    summary: '',
    content: '',
    location: 'Dojo Central',
    startsAt: '2026-10-10T13:00:00.000Z',
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    status: 'draft',
    audience: 'members',
    flyer: { status: 'none', key: null, type: null, sizeBytes: null, name: null },
    whatsappNumber: '5519999991155',
    whatsappMessage: 'Olá! Tenho interesse.',
    contactLabel: '',
    createdBy: 'user-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminGroups.list.mockResolvedValue([
    { id: 'group-1', name: 'Faixas pretas', description: '', memberCount: 3, createdAt: '' },
  ]);
  mockAdminUsers.list.mockResolvedValue({
    data: [{ id: 'user-9', name: 'Ana Souza', email: 'ana@example.com', roles: [], groups: [] }],
    total: 1,
  });
});

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

describe('EventForm — the payload it issues', () => {
  it('creates a draft with the slug it showed, the instant in the event zone and the pre-filled contact', async () => {
    const user = userEvent.setup();
    const created = makeEvent();
    mockAdminEvents.create.mockResolvedValue(created);
    mockAdminEvents.replaceAudience.mockResolvedValue({ groupIds: [], userIds: [] });
    const onCreated = vi.fn();

    renderForm({ onCreated });

    await user.type(screen.getByLabelText(d.form.titleLabel), 'Seminário de Outubro');
    await user.type(screen.getByLabelText(d.form.startsAtLabel), '2026-10-10T10:00');
    await user.click(screen.getByRole('button', { name: d.form.createButton }));

    await waitFor(() => expect(mockAdminEvents.create).toHaveBeenCalledTimes(1));
    const payload = mockAdminEvents.create.mock.calls[0][0];

    expect(payload.title).toBe('Seminário de Outubro');
    // Derived once, at creation — and named explicitly so the event gets the
    // slug the form displayed.
    expect(payload.slug).toBe('seminario-de-outubro');
    // 10:00 in São Paulo (UTC-3) is 13:00 UTC, not 10:00 UTC and not the
    // authoring machine's zone.
    expect(payload.startsAt).toBe('2026-10-10T13:00:00.000Z');
    expect(payload.timezone).toBe('America/Sao_Paulo');
    expect(payload.endsAt).toBeNull();
    // Pre-filled from the tenant brand, then persisted like any other column.
    expect(payload.whatsappNumber).toBe('5519999991155');
    expect(payload.whatsappMessage).toContain('Seminário de Outubro');
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('never sends a slug when an existing event is merely renamed', async () => {
    const user = userEvent.setup();
    const event = makeEvent();
    mockAdminEvents.update.mockResolvedValue(event);

    renderForm({ event });

    const titleInput = screen.getByLabelText(d.form.titleLabel);
    await user.clear(titleInput);
    await user.type(titleInput, 'Outro nome completamente diferente');
    await user.click(screen.getByRole('button', { name: d.form.saveButton }));

    await waitFor(() => expect(mockAdminEvents.update).toHaveBeenCalledTimes(1));
    const [, payload] = mockAdminEvents.update.mock.calls[0];
    expect(payload).not.toHaveProperty('slug');
    // …and the field itself did not move either.
    expect(screen.getByLabelText(d.slug.label)).toHaveValue('seminario-de-outubro');
  });

  it('only lets the slug move after the broken-links warning is read and accepted', async () => {
    const user = userEvent.setup();
    renderForm({ event: makeEvent() });

    const slugInput = screen.getByLabelText(d.slug.label);
    expect(slugInput).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: d.slug.overrideButton }));
    expect(screen.getByText(d.slug.overrideWarning)).toBeInTheDocument();
    // Still frozen while the warning is merely on screen.
    expect(screen.getByLabelText(d.slug.label)).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: d.slug.overrideConfirm }));
    expect(screen.getByLabelText(d.slug.label)).not.toHaveAttribute('readonly');
  });
});

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

describe('EventForm — the audience selector', () => {
  it('reveals the group and user pickers only for restricted, and warns on public', async () => {
    const user = userEvent.setup();
    renderForm();

    // `restricted` is the safe default, so the pickers load straight away.
    expect(await screen.findByText('Faixas pretas')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.queryByText(d.audience.publicWarning)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: new RegExp(d.audience.optionMembers) }));
    expect(screen.queryByText('Faixas pretas')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument();
    expect(screen.queryByText(d.audience.publicWarning)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: new RegExp(d.audience.optionPublic) }));
    expect(screen.queryByText('Faixas pretas')).not.toBeInTheDocument();
    // The warning names the contact number, not just the event.
    expect(screen.getByText(d.audience.publicWarning)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The contact message
// ---------------------------------------------------------------------------

describe('EventForm — the WhatsApp message prefill', () => {
  it('follows the title while untouched and shows what the visitor will send', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(d.form.titleLabel), 'Grad');
    const message = screen.getByLabelText(d.contact.messageLabel) as HTMLTextAreaElement;
    await waitFor(() => expect(message.value).toContain('Grad'));

    await user.type(screen.getByLabelText(d.form.titleLabel), 'uação');
    await waitFor(() => expect(message.value).toContain('Graduação'));
    // No stale warning while the message is still following the title.
    expect(screen.queryByText(d.contact.titleChangedWarning)).not.toBeInTheDocument();
  });

  it('warns instead of overwriting once a human has edited the message', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(d.form.titleLabel), 'Primeiro nome');
    const message = screen.getByLabelText(d.contact.messageLabel);
    await user.clear(message);
    await user.type(message, 'Texto escrito à mão');

    await user.type(screen.getByLabelText(d.form.titleLabel), ' revisado');

    // The human's text survives untouched…
    expect(message).toHaveValue('Texto escrito à mão');
    // …and the risk is stated rather than silently fixed.
    expect(await screen.findByText(d.contact.titleChangedWarning)).toBeInTheDocument();
  });

  it('says plainly that an empty number means no button and an empty message means no text', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText(d.contact.messageLabel));
    expect(screen.getByText(d.contact.previewNoMessage)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(d.contact.numberLabel));
    expect(screen.getByText(d.contact.previewNoNumber)).toBeInTheDocument();
    // With no number there is no button to preview at all.
    expect(screen.queryByText(d.contact.previewNoMessage)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

describe('EventForm — the gates it mirrors', () => {
  it('offers a content_creator no usable publish control, and says why', () => {
    renderForm({ event: makeEvent(), canPublish: false });

    expect(screen.getByRole('button', { name: d.publish.publishButton })).toBeDisabled();
    expect(screen.getByText(d.publish.adminOnly)).toBeInTheDocument();
  });

  it('lets an admin publish, and surfaces the API 403 if it still refuses', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    mockAdminEvents.update.mockResolvedValueOnce(makeEvent({ status: 'published' }));

    renderForm({ event: makeEvent(), canPublish: true, onReload });

    const publish = screen.getByRole('button', { name: d.publish.publishButton });
    expect(publish).toBeEnabled();
    await user.click(publish);

    await waitFor(() =>
      expect(mockAdminEvents.update).toHaveBeenCalledWith('event-1', { status: 'published' }),
    );
    expect(onReload).toHaveBeenCalled();

    mockAdminEvents.update.mockRejectedValueOnce(new AdminEventsApiError(403, 'Forbidden'));
    await user.click(screen.getByRole('button', { name: d.publish.publishButton }));
    expect(await screen.findByText(d.publish.forbidden)).toBeInTheDocument();
  });

  it('renders no delete control anywhere — removal is the archive action', () => {
    const { container } = renderForm({ event: makeEvent(), canPublish: true });

    const controls = within(container).queryAllByRole('button');
    const links = within(container).queryAllByRole('link');
    const destructive = /excluir|apagar|remover evento|delete/i;
    for (const node of [...controls, ...links]) {
      expect(node.textContent ?? '').not.toMatch(destructive);
    }
    expect(screen.getByRole('button', { name: d.publish.archiveButton })).toBeInTheDocument();
  });
});
