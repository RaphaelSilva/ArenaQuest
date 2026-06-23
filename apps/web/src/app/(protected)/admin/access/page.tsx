'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type { TopicNode } from '@web/lib/admin-topics-api';
import type { UserGrant, GroupGrant } from '@web/lib/admin-enrollment-api';
import type { AdminGroup } from '@web/lib/admin-groups-api';
import type { Entities } from '@arenaquest/shared/types/entities';

export const runtime = 'edge';

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

type TopicWithDepth = TopicNode & { depth: number };

function buildTopicTree(topics: TopicNode[]): TopicWithDepth[] {
  const result: TopicWithDepth[] = [];

  function visit(parentId: string | null, depth: number) {
    for (const t of topics) {
      if ((t.parentId ?? null) === parentId) {
        result.push({ ...t, depth });
        visit(t.id, depth + 1);
      }
    }
  }

  visit(null, 0);
  return result;
}

// ---------------------------------------------------------------------------
// Topic picker dialog (hierarchical, reusing enrollment.* copy)
// ---------------------------------------------------------------------------

type TopicPickerDialogProps = {
  topics: TopicNode[];
  grantedIds: Set<string>;
  onSelect: (topicId: string) => void;
  onClose: () => void;
};

function TopicPickerDialog({ topics, grantedIds, onSelect, onClose }: TopicPickerDialogProps) {
  const dict = useDict();
  const [search, setSearch] = useState('');

  const tree = buildTopicTree(
    topics.filter((t) => !t.archived && t.status === 'published'),
  );

  const visible = search
    ? tree.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tree;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.enrollment.pickerTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        className="flex w-full max-w-md flex-col rounded-xl shadow-xl"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', maxHeight: '80vh' }}
      >
        <div className="p-4 pb-0">
          <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--text)' }}>
            {dict.enrollment.pickerTitle}
          </h2>
          <input
            type="search"
            placeholder={dict.enrollment.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}
          />
        </div>

        <ul className="mt-3 flex-1 overflow-y-auto px-4 pb-2 space-y-1">
          {visible.length === 0 ? (
            <li className="py-4 text-center text-sm" style={{ color: 'var(--text2)' }}>
              {dict.enrollment.noTopicsFound}
            </li>
          ) : (
            visible.map((t) => {
              const already = grantedIds.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => onSelect(t.id)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                    style={{
                      color: 'var(--text)',
                      paddingLeft: `${0.75 + t.depth * 1.25}rem`,
                    }}
                  >
                    {t.depth > 0 && (
                      <span className="mr-1 opacity-40">{'└'}</span>
                    )}
                    {t.title}
                    {already && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--accent3)' }}>
                        {dict.enrollment.alreadyGranted}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
          >
            {dict.enrollment.cancelButton}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revoke confirm dialog (reusing enrollment.* copy)
// ---------------------------------------------------------------------------

type RevokeDialogProps = {
  topicTitle: string;
  onConfirm: (cascade: boolean) => void;
  onCancel: () => void;
};

function RevokeDialog({ topicTitle, onConfirm, onCancel }: RevokeDialogProps) {
  const dict = useDict();
  const [cascade, setCascade] = useState(false);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.enrollment.revokeDialog.title(topicTitle)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-xl"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <p className="mb-4 text-sm" style={{ color: 'var(--text)' }}>
          {dict.enrollment.revokeDialog.title(topicTitle)}
        </p>
        <label className="mb-6 flex items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            aria-label={dict.enrollment.revokeDialog.cascade}
          />
          {dict.enrollment.revokeDialog.cascade}
        </label>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ color: 'var(--text2)' }}
          >
            {dict.enrollment.revokeDialog.cancelButton}
          </button>
          <button
            onClick={() => onConfirm(cascade)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{ background: 'var(--error)' }}
          >
            {dict.enrollment.revokeDialog.revokeButton}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grant panel — shown once a principal is selected
// ---------------------------------------------------------------------------

type GrantPanelProps = {
  principalType: 'user' | 'group';
  principalId: string;
};

function GrantPanel({ principalType, principalId }: GrantPanelProps) {
  const dict = useDict();
  const client = useApiClient();

  type AnyGrant = UserGrant | GroupGrant;
  const [grants, setGrants] = useState<AnyGrant[]>([]);
  const [allTopics, setAllTopics] = useState<TopicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AnyGrant | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [g, t] = await Promise.all([
        principalType === 'user'
          ? client.adminEnrollment.listUserGrants(principalId)
          : client.adminEnrollment.listGroupGrants(principalId),
        client.adminTopics.list(),
      ]);
      setGrants(g);
      setAllTopics(t);
    } catch {
      setError(dict.enrollment.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, principalType, principalId, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  const topicMap = new Map(allTopics.map((t) => [t.id, t]));
  const grantedIds = new Set(grants.map((g) => g.topicNodeId));

  const handleGrant = async (topicId: string) => {
    setShowPicker(false);
    setBusy(true);
    try {
      const { grant } =
        principalType === 'user'
          ? await client.adminEnrollment.grantUserTopic(principalId, topicId)
          : await client.adminEnrollment.grantGroupTopic(principalId, topicId);
      setGrants((prev) => [...prev.filter((g) => g.topicNodeId !== topicId), grant]);
    } catch {
      setError(dict.enrollment.errorGrant);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (cascade: boolean) => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    setBusy(true);
    try {
      if (principalType === 'user') {
        await client.adminEnrollment.revokeUserTopic(principalId, target.topicNodeId, cascade);
      } else {
        await client.adminEnrollment.revokeGroupTopic(principalId, target.topicNodeId, cascade);
      }
      setGrants((prev) => prev.filter((g) => g.id !== target.id));
    } catch {
      setError(dict.enrollment.errorRevoke);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-zinc-400" />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {dict.enrollment.directGrantsTitle(grants.length)}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowPicker(true)}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:opacity-60"
          style={{ background: 'var(--accent)', color: '#0B0E17' }}
        >
          {dict.enrollment.grantButton}
        </button>
      </div>

      {grants.length === 0 ? (
        <p
          className="rounded-xl border border-dashed py-8 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          {dict.enrollment.noGrants}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Granted topics">
          {grants.map((grant) => {
            const topic = topicMap.get(grant.topicNodeId);
            return (
              <li
                key={grant.id}
                className="flex items-center justify-between rounded-xl border px-4 py-3"
                style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {topic?.title ?? grant.topicNodeId}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>
                    {dict.enrollment.grantedAt} {new Date(grant.grantedAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRevokeTarget(grant)}
                  aria-label={`${dict.enrollment.revokeButton} ${topic?.title ?? grant.topicNodeId}`}
                  className="rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ color: 'var(--error)', background: 'var(--error-bg)' }}
                >
                  {dict.enrollment.revokeButton}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showPicker && (
        <TopicPickerDialog
          topics={allTopics}
          grantedIds={grantedIds}
          onSelect={(id) => void handleGrant(id)}
          onClose={() => setShowPicker(false)}
        />
      )}

      {revokeTarget && (
        <RevokeDialog
          topicTitle={topicMap.get(revokeTarget.topicNodeId)?.title ?? revokeTarget.topicNodeId}
          onConfirm={(cascade) => void handleRevoke(cascade)}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner page content (needs useSearchParams, wrapped in Suspense)
// ---------------------------------------------------------------------------

type Principal =
  | { type: 'user'; id: string; label: string; sublabel: string }
  | { type: 'group'; id: string; label: string; sublabel: string };

function AccessPageContent() {
  const dict = useDict();
  const client = useApiClient();
  const params = useSearchParams();
  const d = dict.admin.access;

  const paramType = params.get('type') as 'user' | 'group' | null;
  const paramId = params.get('id');

  const [principalType, setPrincipalType] = useState<'user' | 'group'>(
    paramType === 'group' ? 'group' : 'user',
  );
  const [users, setUsers] = useState<Entities.Identity.User[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Principal | null>(null);

  // Load users + groups once
  useEffect(() => {
    setLoadingList(true);
    Promise.all([
      client.adminUsers.list(1, 200).then((r) => r.data),
      client.adminGroups.list(),
    ])
      .then(([u, g]) => {
        setUsers(u);
        setGroups(g);
        // Pre-select from URL params
        if (paramType === 'user' && paramId) {
          const match = u.find((x) => x.id === paramId);
          if (match) {
            setSelected({ type: 'user', id: match.id, label: match.name, sublabel: match.email });
          }
        } else if (paramType === 'group' && paramId) {
          const match = g.find((x) => x.id === paramId);
          if (match) {
            setSelected({
              type: 'group',
              id: match.id,
              label: match.name,
              sublabel: d.membersCount(match.memberCount),
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTypeToggle = (t: 'user' | 'group') => {
    setPrincipalType(t);
    setSelected(null);
    setSearch('');
  };

  const searchLower = search.toLowerCase();
  const visibleUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchLower) ||
      u.email.toLowerCase().includes(searchLower),
  );
  const visibleGroups = groups.filter((g) => g.name.toLowerCase().includes(searchLower));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.title}
      </h1>
      <p className="mb-8 text-sm" style={{ color: 'var(--text2)' }}>
        {d.subtitle}
      </p>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Principal selector panel */}
        <aside
          className="w-full flex-shrink-0 rounded-xl border lg:w-72"
          style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
        >
          {/* Toggle */}
          <div
            className="flex border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            {(['user', 'group'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeToggle(t)}
                className="flex-1 py-2 text-sm font-medium transition-colors"
                style={{
                  color: principalType === t ? 'var(--accent)' : 'var(--text2)',
                  borderBottom: principalType === t ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {t === 'user' ? dict.enrollment.users : dict.enrollment.groups}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="p-3">
            <input
              type="search"
              placeholder={
                principalType === 'user' ? d.searchUsersPlaceholder : d.searchGroupsPlaceholder
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>

          {/* List */}
          {loadingList ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5 text-zinc-400" />
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto px-2 pb-2">
              {principalType === 'user'
                ? visibleUsers.map((u) => {
                    const isActive = selected?.id === u.id;
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({ type: 'user', id: u.id, label: u.name, sublabel: u.email })
                          }
                          className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
                          style={{
                            background: isActive ? 'var(--accent-bg)' : 'transparent',
                            color: 'var(--text)',
                          }}
                        >
                          <span className="block font-medium">{u.name}</span>
                          <span className="block text-xs" style={{ color: 'var(--text3)' }}>
                            {u.email}
                          </span>
                        </button>
                      </li>
                    );
                  })
                : visibleGroups.map((g) => {
                    const isActive = selected?.id === g.id;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({
                              type: 'group',
                              id: g.id,
                              label: g.name,
                              sublabel: d.membersCount(g.memberCount),
                            })
                          }
                          className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
                          style={{
                            background: isActive ? 'var(--accent-bg)' : 'transparent',
                            color: 'var(--text)',
                          }}
                        >
                          <span className="block font-medium">{g.name}</span>
                          <span className="block text-xs" style={{ color: 'var(--text3)' }}>
                            {d.membersCount(g.memberCount)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          )}
        </aside>

        {/* Grant panel */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <div>
              <div className="mb-4">
                <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>
                  {selected.label}
                </p>
                <p className="text-sm" style={{ color: 'var(--text3)' }}>
                  {selected.sublabel}
                </p>
              </div>
              <GrantPanel key={`${selected.type}:${selected.id}`} principalType={selected.type} principalId={selected.id} />
            </div>
          ) : (
            <div
              className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed"
              style={{ borderColor: 'var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                {d.pickPrincipalPrompt}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page — admin guard + Suspense boundary for useSearchParams
// ---------------------------------------------------------------------------

export default function AdminAccessPage() {
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="h-8 w-8 text-zinc-400" />
        </div>
      }
    >
      <AccessPageContent />
    </Suspense>
  );
}
