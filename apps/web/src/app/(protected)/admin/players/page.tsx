'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Entities } from '@arenaquest/shared/types/entities';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Button, Input } from '@web/components/design-system';
import {
  AdminGamificationApiError,
  type Badge,
  type PlayerProgression,
} from '@web/lib/admin-gamification-api';

type User = Entities.Identity.User;

type ConfirmState = {
  message: string;
  onConfirm: () => void;
};

export default function AdminPlayersPage() {
  const dict = useDict();
  const d = dict.admin.players;
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const isAdmin = useHasRole(ROLES.ADMIN);

  // User search
  const [users, setUsers] = useState<User[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Badge catalog (award picker)
  const [catalog, setCatalog] = useState<Badge[]>([]);

  // Progression panel
  const [progression, setProgression] = useState<PlayerProgression | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // Mutation feedback
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // XP adjustment form
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Inline confirmation
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const [usersRes, badgesRes] = await Promise.all([
          client.adminUsers.list(1, 100),
          client.adminGamification.badges.list(),
        ]);
        setUsers(usersRes.data);
        setCatalog(badgesRes);
        setUsersError(null);
      } catch (e) {
        setUsersError(e instanceof Error ? e.message : d.search.loadError);
      }
    })();
  }, [client, isAdmin, d.search.loadError]);

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, filter]);

  const loadProgression = useCallback(
    async (userId: string) => {
      setPanelLoading(true);
      setPanelError(null);
      try {
        const data = await client.adminGamification.progression.get(userId);
        setProgression(data);
      } catch (e) {
        setProgression(null);
        setPanelError(e instanceof Error ? e.message : d.panel.loadError);
      } finally {
        setPanelLoading(false);
      }
    },
    [client, d.panel.loadError],
  );

  const selectUser = (user: User) => {
    setSelectedUser(user);
    setFeedback(null);
    setActionError(null);
    setAdjustError(null);
    setPoints('');
    setReason('');
    void loadProgression(user.id);
  };

  const availableBadges = useMemo(() => {
    if (!progression) return [];
    const earned = new Set(progression.badges.map((b) => b.badgeId));
    return catalog.filter((b) => b.active && !earned.has(b.id));
  }, [catalog, progression]);

  const runMutation = useCallback(
    async (fn: () => Promise<void>, fallback: string) => {
      if (!selectedUser) return;
      setBusy(true);
      setFeedback(null);
      setActionError(null);
      try {
        await fn();
        await loadProgression(selectedUser.id);
      } catch (e) {
        if (e instanceof AdminGamificationApiError && e.status === 404) {
          setActionError(d.badges.notFound);
        } else {
          setActionError(e instanceof Error ? e.message : fallback);
        }
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [selectedUser, loadProgression, d.badges.notFound],
  );

  const handleAward = (badge: Badge) => {
    if (!selectedUser) return;
    setConfirm({
      message: d.confirm.award(badge.name, selectedUser.name),
      onConfirm: () =>
        void runMutation(
          () => client.adminGamification.progression.awardBadge(selectedUser.id, badge.id),
          d.badges.notFound,
        ),
    });
  };

  const handleRevoke = (badgeId: string, badgeName: string) => {
    if (!selectedUser) return;
    setConfirm({
      message: d.confirm.revoke(badgeName, selectedUser.name),
      onConfirm: () =>
        void runMutation(
          () => client.adminGamification.progression.revokeBadge(selectedUser.id, badgeId),
          d.badges.notFound,
        ),
    });
  };

  const handleRecompute = () => {
    if (!selectedUser) return;
    setConfirm({
      message: d.confirm.recompute(selectedUser.name),
      onConfirm: () =>
        void runMutation(async () => {
          const res = await client.adminGamification.progression.recomputeXp(selectedUser.id);
          setFeedback(d.recompute.result(res.previousTotal, res.newTotal));
        }, d.recompute.error),
    });
  };

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setAdjustError(null);
    const trimmedReason = reason.trim();
    const numericPoints = Number(points);
    if (!points.trim() || Number.isNaN(numericPoints) || numericPoints === 0) {
      setAdjustError(d.adjust.pointsRequired);
      return;
    }
    if (!trimmedReason) {
      setAdjustError(d.adjust.reasonRequired);
      return;
    }
    const message =
      numericPoints < 0
        ? d.confirm.adjustNegative(numericPoints, selectedUser.name, trimmedReason)
        : d.confirm.adjust(numericPoints, selectedUser.name);
    setConfirm({
      message,
      onConfirm: () =>
        void runMutation(async () => {
          const res = await client.adminGamification.progression.adjustXp(selectedUser.id, {
            points: numericPoints,
            reason: trimmedReason,
          });
          setFeedback(d.adjust.result(res.previousTotal, res.newTotal));
          setPoints('');
          setReason('');
        }, d.adjust.error),
    });
  };

  const prefillClawback = (badgeName: string, xpReward: number | null) => {
    setPoints(xpReward != null ? String(-Math.abs(xpReward)) : '');
    setReason(d.badges.revokeXpNote + ` (${badgeName})`);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }
  if (!isAdmin) return null;

  return (
    <main className="flex-1 overflow-y-auto p-6 md:p-8">
      <div className="mb-6">
        <h1
          className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50"
          style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
        >
          {d.title}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
        {/* User search */}
        <section className="space-y-3">
          <Input
            label={d.search.label}
            placeholder={d.search.placeholder}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            helperText={d.search.hint}
          />
          {usersError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {usersError}
            </p>
          )}
          <ul className="max-h-[28rem] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {filteredUsers.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-zinc-500">{d.search.empty}</li>
            ) : (
              filteredUsers.map((u) => (
                <li key={u.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => selectUser(u)}
                    aria-label={d.search.selectAriaLabel(u.name)}
                    className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                      selectedUser?.id === u.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                    }`}
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{u.name}</span>
                    <span className="text-xs text-zinc-500">{u.email}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Progression panel */}
        <section className="min-w-0">
          {!selectedUser ? (
            <p className="py-12 text-center text-sm text-zinc-500">{d.search.hint}</p>
          ) : panelLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-zinc-400" />
            </div>
          ) : panelError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {panelError}
            </p>
          ) : progression ? (
            <div className="space-y-6">
              {feedback && (
                <p role="status" className="rounded-md bg-emerald-100 px-4 py-2 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                  {feedback}
                </p>
              )}
              {actionError && (
                <p role="alert" className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-900 dark:bg-red-900/30 dark:text-red-200">
                  {actionError}
                </p>
              )}

              {/* XP summary */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{d.panel.totalXp}</p>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{progression.xp.totalXp}</p>
                </div>
                <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{d.panel.level}</p>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{d.panel.levelValue(progression.xp.level)}</p>
                </div>
                <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{d.panel.rank}</p>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{progression.xp.rankTitle}</p>
                </div>
              </div>

              {/* Badges */}
              <div className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.badges.heading}</h2>
                <p className="mb-4 text-xs text-amber-700 dark:text-amber-300">{d.badges.revokeXpNote}</p>

                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{d.badges.earnedHeading}</h3>
                {progression.badges.length === 0 ? (
                  <p className="text-sm text-zinc-500">{d.badges.earnedEmpty}</p>
                ) : (
                  <ul className="mb-5 flex flex-wrap gap-2">
                    {progression.badges.map((b) => {
                      const catalogEntry = catalog.find((c) => c.id === b.badgeId);
                      return (
                        <li
                          key={b.badgeId}
                          className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700"
                        >
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleRevoke(b.badgeId, b.name)}
                            aria-label={d.badges.revokeAriaLabel(b.name)}
                          >
                            {d.badges.revokeButton}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => prefillClawback(b.name, catalogEntry?.xpReward ?? null)}
                            aria-label={d.badges.clawbackAriaLabel(b.name)}
                          >
                            {d.badges.clawbackButton}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{d.badges.awardHeading}</h3>
                {availableBadges.length === 0 ? (
                  <p className="text-sm text-zinc-500">{d.badges.awardEmpty}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {availableBadges.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700"
                      >
                        <span>{b.iconEmoji}</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleAward(b)}
                          aria-label={d.badges.awardAriaLabel(b.name)}
                        >
                          {d.badges.awardButton}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* XP adjustment */}
              <form
                onSubmit={handleAdjustSubmit}
                className="space-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.adjust.heading}</h2>
                <Input
                  label={d.adjust.pointsLabel}
                  type="number"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                    {d.adjust.reasonLabel}
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder={d.adjust.reasonPlaceholder}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                {adjustError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {adjustError}
                  </p>
                )}
                <Button type="submit" variant="primary" size="md" disabled={busy}>
                  {d.adjust.submitButton}
                </Button>
              </form>

              {/* Recompute */}
              <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.recompute.heading}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.recompute.description}</p>
                <Button type="button" variant="secondary" size="md" disabled={busy} onClick={handleRecompute}>
                  {d.recompute.button}
                </Button>
              </div>

              {/* Recent events */}
              <div className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.events.heading}</h2>
                {progression.recentXpEvents.length === 0 ? (
                  <p className="text-sm text-zinc-500">{d.events.empty}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-2 pr-4 font-medium">{d.events.sourceHeader}</th>
                          <th className="py-2 pr-4 font-medium">{d.events.pointsHeader}</th>
                          <th className="py-2 font-medium">{d.events.dateHeader}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {progression.recentXpEvents.map((ev) => (
                          <tr key={ev.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-2 pr-4 font-mono text-xs">{ev.sourceKind}</td>
                            <td className="py-2 pr-4">{ev.points}</td>
                            <td className="py-2 text-zinc-500">{ev.earnedAt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* Inline confirmation */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.confirm.title}</h2>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{confirm.message}</p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" size="md" onClick={() => setConfirm(null)}>
                {d.confirm.cancelButton}
              </Button>
              <Button type="button" variant="primary" size="md" disabled={busy} onClick={confirm.onConfirm}>
                {d.confirm.confirmButton}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
