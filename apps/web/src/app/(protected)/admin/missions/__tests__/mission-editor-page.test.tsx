import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import {
  AdminGamificationApiError,
  type Badge,
  type MissionDetail,
} from '@web/lib/admin-gamification-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

const d = dictEn.admin.missions;
const r = d.requirements;

const TOPIC = '11111111-1111-4111-8111-111111111111';
const MISSION = '99999999-9999-4999-8999-999999999999';
const REQ_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const replace = vi.fn();
const push = vi.fn();
let routeId = 'new';
let role = 'admin';

const api = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replaceRequirements: vi.fn(),
  updateRequirementTitle: vi.fn(),
  replaceAudience: vi.fn(),
  badges: vi.fn(),
  topics: vi.fn(),
  events: vi.fn(),
  price: vi.fn(),
  media: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useParams: () => ({ id: routeId }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: (...roles: string[]) => roles.includes(role),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  const client = {
    adminGamification: {
      missions: {
        get: (...a: unknown[]) => api.get(...a),
        create: (...a: unknown[]) => api.create(...a),
        update: (...a: unknown[]) => api.update(...a),
        replaceRequirements: (...a: unknown[]) => api.replaceRequirements(...a),
        updateRequirementTitle: (...a: unknown[]) => api.updateRequirementTitle(...a),
        replaceAudience: (...a: unknown[]) => api.replaceAudience(...a),
      },
      badges: { list: (...a: unknown[]) => api.badges(...a) },
    },
    adminTopics: { list: (...a: unknown[]) => api.topics(...a) },
    adminEvents: { list: (...a: unknown[]) => api.events(...a) },
    adminBilling: { extras: { getPrice: (...a: unknown[]) => api.price(...a) } },
    adminMedia: { list: (...a: unknown[]) => api.media(...a) },
    adminGroups: { list: async () => [] },
    adminUsers: { list: async () => ({ data: [], total: 0 }) },
  };
  return { ...actual, useApiClient: () => client };
});

import AdminMissionEditorPage from '../[id]/page';

const badge: Badge = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  slug: 'kihon',
  name: 'Kihon Master',
  iconEmoji: '🥋',
  description: null,
  xpReward: null,
  ruleKind: 'manual',
  ruleParams: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const kihon: TopicNode = {
  id: TOPIC,
  parentId: null,
  title: 'Kihon',
  content: '',
  status: 'published',
  archived: false,
  order: 0,
  estimatedMinutes: 0,
  tags: [],
  prerequisiteIds: [],
};

function detail(startAt: string, overrides: Partial<MissionDetail['mission']> = {}): MissionDetail {
  return {
    mission: {
      id: MISSION,
      title: 'Kihon month',
      description: 'Demonstrate, then check yourself.',
      startAt,
      endAt: '2099-12-31T12:00:00.000Z',
      xpReward: 300,
      badgeId: null,
      active: true,
      mode: 'sequential',
      enrollmentMode: 'auto',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    },
    requirements: [
      {
        id: REQ_1,
        missionId: MISSION,
        position: 1,
        kind: 'submissions_on_topic',
        title: 'Three demonstrations',
        topicId: TOPIC,
        eventId: null,
        params: { minCount: 3, requireDescription: true, visibility: 'any', countModerated: false },
        xpReward: 50,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: REQ_2,
        missionId: MISSION,
        position: 2,
        kind: 'manual_check',
        title: 'Self-check',
        topicId: null,
        eventId: null,
        params: { instructions: 'Bow in and out.' },
        xpReward: 20,
        createdAt: '',
        updatedAt: '',
      },
    ],
    audience: { groupIds: [], userIds: [] },
  };
}

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminMissionEditorPage />
    </DictProvider>,
  );
}

const cards = () => screen.getAllByTestId('requirement-card');

function fillMissionCard(start = '2026-11-01T10:00', end = '2026-11-08T10:00') {
  fireEvent.change(screen.getByLabelText(d.fields.title), { target: { value: 'Kihon month' } });
  fireEvent.change(screen.getByLabelText(d.fields.description), { target: { value: 'Demonstrate, then check.' } });
  fireEvent.change(screen.getByLabelText(d.fields.startAt), { target: { value: start } });
  fireEvent.change(screen.getByLabelText(d.fields.endAt), { target: { value: end } });
}

function addStep(kind: keyof typeof r.kinds) {
  fireEvent.change(screen.getByLabelText(r.kindPicker), { target: { value: kind } });
  fireEvent.click(screen.getByRole('button', { name: r.addStep }));
}

describe('AdminMissionEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeId = 'new';
    role = 'admin';
    api.badges.mockResolvedValue([badge]);
    api.topics.mockResolvedValue([kihon]);
    api.events.mockResolvedValue({ data: [], total: 0, limit: 100, offset: 0 });
    api.price.mockResolvedValue(null);
    api.media.mockResolvedValue([]);
    api.create.mockResolvedValue(detail('2026-11-01T10:00:00.000Z'));
    api.update.mockResolvedValue(detail('2099-01-01T00:00:00.000Z').mission);
    api.replaceRequirements.mockResolvedValue([]);
    api.updateRequirementTitle.mockResolvedValue({});
  });

  it('creates a sequential mission with a demonstrations and a self-check step', async () => {
    renderPage();
    await screen.findByRole('heading', { name: d.createTitle });

    fillMissionCard();
    fireEvent.click(screen.getByLabelText(d.modeOptions.sequential));
    fireEvent.change(screen.getByLabelText(d.fields.xpReward), { target: { value: '300' } });

    addStep('submissions_on_topic');
    const demo = cards()[0];
    fireEvent.change(within(demo).getByLabelText(r.fields.title), { target: { value: 'Three demonstrations' } });
    fireEvent.click(within(demo).getByRole('checkbox', { name: /Kihon/ }));
    fireEvent.change(within(demo).getByLabelText(r.fields.minCount), { target: { value: '3' } });
    fireEvent.click(within(demo).getByLabelText(r.fields.requireDescription));
    fireEvent.change(within(demo).getByLabelText(r.fields.xpReward), { target: { value: '50' } });

    addStep('manual_check');
    const check = cards()[1];
    fireEvent.change(within(check).getByLabelText(r.fields.title), { target: { value: 'Self-check' } });
    fireEvent.change(within(check).getByLabelText(r.fields.instructions), { target: { value: 'Bow in and out.' } });
    fireEvent.change(within(check).getByLabelText(r.fields.xpReward), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const body = api.create.mock.calls[0][0];
    expect(body).toEqual({
      title: 'Kihon month',
      description: 'Demonstrate, then check.',
      startAt: new Date('2026-11-01T10:00').toISOString(),
      endAt: new Date('2026-11-08T10:00').toISOString(),
      mode: 'sequential',
      enrollmentMode: 'auto',
      xpReward: 300,
      badgeId: null,
      requirements: [
        {
          kind: 'submissions_on_topic',
          title: 'Three demonstrations',
          xpReward: 50,
          topicId: TOPIC,
          params: { minCount: 3, requireDescription: true, visibility: 'any', countModerated: false },
        },
        { kind: 'manual_check', title: 'Self-check', xpReward: 20, params: { instructions: 'Bow in and out.' } },
      ],
    });
    expect(body).not.toHaveProperty('predicateKind');
    expect(body).not.toHaveProperty('predicateParams');
    expect(body).not.toHaveProperty('active');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/missions'));
  });

  it('shows the badge hint for a 14-day window and still saves without a badge', async () => {
    renderPage();
    await screen.findByRole('heading', { name: d.createTitle });
    fillMissionCard('2026-11-01T10:00', '2026-11-08T10:00');
    expect(screen.queryByTestId('badge-hint')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(d.fields.endAt), { target: { value: '2026-11-15T10:00' } });
    expect(screen.getByTestId('badge-hint')).toHaveTextContent(d.badgeHint);

    addStep('manual_check');
    fireEvent.change(within(cards()[0]).getByLabelText(r.fields.title), { target: { value: 'Check' } });
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0].badgeId).toBeNull();

    fireEvent.change(screen.getByLabelText(d.fields.badge), { target: { value: badge.id } });
    expect(screen.queryByTestId('badge-hint')).not.toBeInTheDocument();
  });

  it('blocks an invalid step on the client and marks its card', async () => {
    renderPage();
    await screen.findByRole('heading', { name: d.createTitle });
    fillMissionCard();
    addStep('manual_check');
    addStep('topic_visited');
    fireEvent.change(within(cards()[0]).getByLabelText(r.fields.title), { target: { value: 'Check' } });
    fireEvent.change(within(cards()[1]).getByLabelText(r.fields.title), { target: { value: 'Visit' } });
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    expect(await within(cards()[1]).findByRole('alert')).toHaveTextContent(d.errors.topicRequired);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('renders a 400 INVALID_REQUIREMENT_TARGET with index 1 on the second card', async () => {
    api.create.mockRejectedValue(
      new AdminGamificationApiError('INVALID_REQUIREMENT_TARGET', 400, {
        error: 'INVALID_REQUIREMENT_TARGET',
        index: 1,
        reason: 'TOPIC_ARCHIVED',
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: d.createTitle });
    fillMissionCard();
    addStep('manual_check');
    addStep('topic_visited');
    fireEvent.change(within(cards()[0]).getByLabelText(r.fields.title), { target: { value: 'Check' } });
    fireEvent.change(within(cards()[1]).getByLabelText(r.fields.title), { target: { value: 'Visit' } });
    fireEvent.click(within(cards()[1]).getByRole('checkbox', { name: /Kihon/ }));
    // The topic's media are read lazily: none ready → the visit warning.
    expect(await within(cards()[1]).findByText(r.noMediaWarning)).toBeInTheDocument();
    expect(api.media).toHaveBeenCalledWith(TOPIC);
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    expect(await within(cards()[1]).findByRole('alert')).toHaveTextContent(d.errors.TOPIC_ARCHIVED);
    expect(within(cards()[0]).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(d.errors.stepsInvalid)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('edits a draft mission: reorders by buttons and saves the new positions', async () => {
    routeId = MISSION;
    api.get.mockResolvedValue(detail('2099-01-01T00:00:00.000Z'));
    renderPage();
    await screen.findByRole('heading', { name: d.editTitle });
    expect(screen.queryByTestId('started-banner')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('step-number').map((n) => n.textContent)).toEqual(['1', '2']);

    fireEvent.click(screen.getByRole('button', { name: r.moveDown(1) }));
    expect(within(cards()[0]).getByLabelText(r.fields.title)).toHaveValue('Self-check');
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(api.replaceRequirements).toHaveBeenCalledTimes(1));
    const [id, requirements] = api.replaceRequirements.mock.calls[0];
    expect(id).toBe(MISSION);
    expect(requirements.map((q: { kind: string }) => q.kind)).toEqual(['manual_check', 'submissions_on_topic']);
    expect(api.update).not.toHaveBeenCalled();
    expect(await screen.findByText(d.savedMessage)).toBeInTheDocument();
  });

  it('hides step numbers when switched to parallel', async () => {
    routeId = MISSION;
    api.get.mockResolvedValue(detail('2099-01-01T00:00:00.000Z'));
    renderPage();
    await screen.findByRole('heading', { name: d.editTitle });
    fireEvent.click(screen.getByLabelText(d.modeOptions.parallel));
    expect(screen.queryAllByTestId('step-number')).toHaveLength(0);
  });

  it('after start, locks all but title, description, end and active, and renames steps by title only', async () => {
    routeId = MISSION;
    api.get.mockResolvedValue(detail('2020-01-01T00:00:00.000Z'));
    renderPage();
    await screen.findByRole('heading', { name: d.editTitle });

    expect(screen.getByTestId('started-banner')).toHaveTextContent(d.startedBanner);
    expect(screen.getByLabelText(d.fields.title)).toBeEnabled();
    expect(screen.getByLabelText(d.fields.description)).toBeEnabled();
    expect(screen.getByLabelText(d.fields.endAt)).toBeEnabled();
    expect(screen.getByLabelText(d.fields.active)).toBeEnabled();
    expect(screen.getByLabelText(d.fields.startAt)).toBeDisabled();
    expect(screen.getByLabelText(d.fields.xpReward)).toBeDisabled();
    expect(screen.getByLabelText(d.fields.badge)).toBeDisabled();
    expect(screen.getByLabelText(d.modeOptions.parallel)).toBeDisabled();
    expect(screen.getByRole('radio', { name: new RegExp(d.enrollmentOptions.open) })).toBeDisabled();
    expect(screen.queryByRole('button', { name: r.addStep })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: r.moveDown(1) })).not.toBeInTheDocument();
    expect(within(cards()[0]).getByLabelText(r.fields.minCount)).toBeDisabled();
    expect(within(cards()[0]).getByLabelText(r.fields.title)).toBeEnabled();

    fireEvent.change(screen.getByLabelText(d.fields.title), { target: { value: 'Kihon month II' } });
    fireEvent.change(within(cards()[1]).getByLabelText(r.fields.title), { target: { value: 'Final self-check' } });
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith(MISSION, { title: 'Kihon month II' }));
    await waitFor(() =>
      expect(api.updateRequirementTitle).toHaveBeenCalledWith(MISSION, REQ_2, 'Final self-check'),
    );
    expect(api.replaceRequirements).not.toHaveBeenCalled();
  });

  it('switches to the started state on a 409 MISSION_STARTED', async () => {
    routeId = MISSION;
    api.get.mockResolvedValue(detail('2099-01-01T00:00:00.000Z'));
    api.update.mockRejectedValue(
      new AdminGamificationApiError('MISSION_STARTED', 409, { error: 'MISSION_STARTED', fields: ['mode'] }),
    );
    renderPage();
    await screen.findByRole('heading', { name: d.editTitle });
    fireEvent.click(screen.getByLabelText(d.modeOptions.parallel));
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));

    expect(await screen.findByTestId('started-banner')).toBeInTheDocument();
    expect(screen.getByText(d.errors.MISSION_STARTED)).toBeInTheDocument();
    expect(screen.getByLabelText(d.fields.startAt)).toBeDisabled();
  });

  it('saves the card of a legacy mission (no steps) without asking for a step', async () => {
    routeId = MISSION;
    api.get.mockResolvedValue({ ...detail('2099-01-01T00:00:00.000Z'), requirements: [] });
    renderPage();
    await screen.findByRole('heading', { name: d.editTitle });
    fireEvent.click(screen.getByLabelText(d.fields.active));
    fireEvent.click(screen.getByRole('button', { name: d.saveButton }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(MISSION, { active: false }));
    expect(api.replaceRequirements).not.toHaveBeenCalled();
  });

  it('renders every control read-only for a content creator', async () => {
    role = 'content_creator';
    routeId = MISSION;
    api.get.mockResolvedValue(detail('2099-01-01T00:00:00.000Z'));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: d.viewTitle });

    expect(screen.getByText(d.readOnlyNotice)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.saveButton })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: r.addStep })).not.toBeInTheDocument();
    expect(screen.getByLabelText(d.fields.title)).toBeDisabled();
    expect(screen.getByLabelText(d.fields.description)).toBeDisabled();
    expect(screen.getByLabelText(d.fields.endAt)).toBeDisabled();
    expect(within(cards()[0]).getByLabelText(r.fields.title)).toBeDisabled();
    expect(api.price).not.toHaveBeenCalled();
  });

  it('sends a content creator away from the create page', async () => {
    role = 'content_creator';
    routeId = 'new';
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/missions'));
    expect(screen.queryByRole('button', { name: d.saveButton })).not.toBeInTheDocument();
  });
});
