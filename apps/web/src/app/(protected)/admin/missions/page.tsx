'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Badge as BadgePill, Button, Input } from '@web/components/design-system';
import type { Badge, CreateMissionInput, Mission } from '@web/lib/admin-gamification-api';

type FormState = {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: string;
  badgeId: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  startAt: '',
  endAt: '',
  predicateKind: '',
  predicateParams: '',
  xpReward: '',
  badgeId: '',
  active: true,
};

export default function AdminMissionsPage() {
  const dict = useDict();
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canEditEconomy = useHasRole(ROLES.ADMIN);

  const [missions, setMissions] = useState<Mission[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [missionList, badgeList] = await Promise.all([
        client.adminGamification.missions.list(),
        client.adminGamification.badges.list(),
      ]);
      setMissions(missionList);
      setBadges(badgeList);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.missions.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, dict.admin.missions.loadError]);

  useEffect(() => {
    if (!authLoading && !canAuthor) {
      router.replace('/dashboard');
      return;
    }
    if (canAuthor) void reload();
  }, [authLoading, canAuthor, reload, router]);

  const predicateParamsPreview = useMemo(() => {
    if (!form.predicateParams.trim()) return { ok: true as const, value: null };
    try {
      return { ok: true as const, value: JSON.stringify(JSON.parse(form.predicateParams), null, 2) };
    } catch {
      return { ok: false as const, value: null };
    }
  }, [form.predicateParams]);

  const badgeName = useCallback(
    (id: string | null) => badges.find((b) => b.id === id)?.name ?? dict.admin.missions.noBadge,
    [badges, dict.admin.missions.noBadge],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (mission: Mission) => {
    setEditingId(mission.id);
    setForm({
      title: mission.title,
      description: mission.description,
      startAt: mission.startAt.slice(0, 16),
      endAt: mission.endAt.slice(0, 16),
      predicateKind: mission.predicateKind,
      predicateParams: mission.predicateParams,
      xpReward: String(mission.xpReward),
      badgeId: mission.badgeId ?? '',
      active: mission.active,
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!predicateParamsPreview.ok) {
      setFormError(dict.admin.missions.predicateParamsInvalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    const base = {
      title: form.title,
      description: form.description,
      startAt: new Date(form.startAt).toISOString(),
      endAt: new Date(form.endAt).toISOString(),
      predicateKind: form.predicateKind,
      predicateParams: form.predicateParams,
      badgeId: form.badgeId || null,
      active: form.active,
    };
    try {
      if (editingId) {
        await client.adminGamification.missions.update(editingId, {
          ...base,
          ...(canEditEconomy ? { xpReward: Number(form.xpReward) } : {}),
        });
      } else {
        const input: CreateMissionInput = {
          ...base,
          xpReward: form.xpReward.trim() ? Number(form.xpReward) : 0,
        };
        await client.adminGamification.missions.create(input);
      }
      closeForm();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : dict.admin.missions.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mission: Mission) => {
    if (!window.confirm(dict.admin.missions.deleteConfirm(mission.title))) return;
    try {
      await client.adminGamification.missions.delete(mission.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.missions.deleteError);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }
  if (!canAuthor) return null;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h1 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
            {dict.admin.missions.title}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{dict.admin.missions.subtitle}</p>
        </div>
        <Button onClick={openCreate} variant="primary" size="md">
          {dict.admin.missions.newButton}
        </Button>
      </div>

      <div className="p-6 space-y-6">
        <p className="rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {dict.admin.missions.periodWarning}
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {editingId ? dict.admin.missions.editTitle : dict.admin.missions.createTitle}
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={dict.admin.missions.fields.title}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.missions.fields.predicateKind}
                value={form.predicateKind}
                onChange={(e) => setForm((f) => ({ ...f, predicateKind: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.missions.fields.startAt}
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.missions.fields.endAt}
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.missions.fields.xpReward}
                type="number"
                value={form.xpReward}
                onChange={(e) => setForm((f) => ({ ...f, xpReward: e.target.value }))}
                disabled={!canEditEconomy}
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                  {dict.admin.missions.fields.badge}
                </span>
                <select
                  value={form.badgeId}
                  onChange={(e) => setForm((f) => ({ ...f, badgeId: e.target.value }))}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">{dict.admin.missions.noBadge}</option>
                  {badges.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {dict.admin.missions.fields.description}
              </span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {dict.admin.missions.fields.predicateParams}
              </span>
              <textarea
                value={form.predicateParams}
                onChange={(e) => setForm((f) => ({ ...f, predicateParams: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                required
              />
            </label>

            {form.predicateParams.trim() && (
              predicateParamsPreview.ok ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{dict.admin.missions.predicateParamsPreview}</p>
                  <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">{predicateParamsPreview.value}</pre>
                </div>
              ) : (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{dict.admin.missions.predicateParamsInvalid}</p>
              )
            )}

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              {dict.admin.missions.fields.active}
            </label>

            {formError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex justify-end gap-3">
              <Button type="button" onClick={closeForm} variant="secondary" size="md">
                {dict.admin.missions.cancelButton}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={saving} isLoading={saving}>
                {saving ? dict.admin.missions.savingButton : dict.admin.missions.saveButton}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : missions.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{dict.admin.missions.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.title}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.window}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.predicate}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.xpReward}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.badge}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.missions.columns.active}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {missions.map((mission) => (
                  <tr key={mission.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{mission.title}</td>
                    <td className="px-4 py-2 text-xs">{dict.admin.missions.windowRange(mission.startAt, mission.endAt)}</td>
                    <td className="px-4 py-2"><span className="font-mono text-xs">{mission.predicateKind} {mission.predicateParams}</span></td>
                    <td className="px-4 py-2">{mission.xpReward}</td>
                    <td className="px-4 py-2">{badgeName(mission.badgeId)}</td>
                    <td className="px-4 py-2">
                      <BadgePill status={mission.active ? 'active' : 'inactive'} size="sm">
                        {mission.active ? dict.admin.missions.activeLabel : dict.admin.missions.inactiveLabel}
                      </BadgePill>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button type="button" onClick={() => openEdit(mission)} variant="secondary" size="sm">
                          {dict.admin.missions.editButton}
                        </Button>
                        <Button type="button" onClick={() => handleDelete(mission)} variant="danger" size="sm">
                          {dict.admin.missions.deleteButton}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
