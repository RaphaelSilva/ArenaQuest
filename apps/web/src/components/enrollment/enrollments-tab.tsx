'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { UserGrant } from '@web/lib/admin-enrollment-api';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { Spinner } from '@web/components/spinner';

// ---------------------------------------------------------------------------
// Topic picker dialog
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

  const visible = topics
    .filter((t) => !t.archived && t.status === 'published')
    .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title));

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
                    style={{ color: 'var(--text)' }}
                  >
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
// Revoke confirm dialog
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
// EnrollmentsTab
// ---------------------------------------------------------------------------

export type EnrollmentsTabProps = {
  userId: string;
};

export function EnrollmentsTab({ userId }: EnrollmentsTabProps) {
  const dict = useDict();
  const client = useApiClient();
  const [grants, setGrants] = useState<UserGrant[]>([]);
  const [allTopics, setAllTopics] = useState<TopicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<UserGrant | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, t] = await Promise.all([
        client.adminEnrollment.listUserGrants(userId),
        client.adminTopics.list(),
      ]);
      setGrants(g);
      setAllTopics(t);
    } catch {
      setError(dict.enrollment.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, userId, dict]);

  useEffect(() => {
    void load();
  }, [load]);

  const topicMap = new Map(allTopics.map((t) => [t.id, t]));
  const grantedIds = new Set(grants.map((g) => g.topicNodeId));

  const handleGrant = async (topicId: string) => {
    setShowPicker(false);
    setBusy(true);
    try {
      const { grant } = await client.adminEnrollment.grantUserTopic(userId, topicId);
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
      await client.adminEnrollment.revokeUserTopic(userId, target.topicNodeId, cascade);
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
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text3)' }}
        >
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
