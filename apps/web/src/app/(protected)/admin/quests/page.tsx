'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Badge as BadgePill, Button, Input } from '@web/components/design-system';
import type { CreateQuestInput, Quest, QuestKind } from '@web/lib/admin-gamification-api';

type FormState = {
  kind: QuestKind;
  title: string;
  description: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  kind: 'daily',
  title: '',
  description: '',
  predicateKind: '',
  predicateParams: '',
  xpReward: '',
  active: true,
};

const KINDS: QuestKind[] = ['daily', 'weekly'];

export default function AdminQuestsPage() {
  const dict = useDict();
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canEditEconomy = useHasRole(ROLES.ADMIN);

  const [quests, setQuests] = useState<Quest[]>([]);
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
      const list = await client.adminGamification.quests.list();
      setQuests(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.quests.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, dict.admin.quests.loadError]);

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

  const groups = useMemo(
    () => KINDS.map((kind) => ({ kind, items: quests.filter((q) => q.kind === kind) })),
    [quests],
  );

  const kindLabel = useCallback(
    (kind: QuestKind) => (kind === 'daily' ? dict.admin.quests.kindDaily : dict.admin.quests.kindWeekly),
    [dict.admin.quests.kindDaily, dict.admin.quests.kindWeekly],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (quest: Quest) => {
    setEditingId(quest.id);
    setForm({
      kind: quest.kind,
      title: quest.title,
      description: quest.description,
      predicateKind: quest.predicateKind,
      predicateParams: quest.predicateParams,
      xpReward: String(quest.xpReward),
      active: quest.active,
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
      setFormError(dict.admin.quests.predicateParamsInvalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    const base = {
      kind: form.kind,
      title: form.title,
      description: form.description,
      predicateKind: form.predicateKind,
      predicateParams: form.predicateParams,
      active: form.active,
    };
    try {
      if (editingId) {
        await client.adminGamification.quests.update(editingId, {
          ...base,
          ...(canEditEconomy ? { xpReward: Number(form.xpReward) } : {}),
        });
      } else {
        const input: CreateQuestInput = {
          ...base,
          xpReward: form.xpReward.trim() ? Number(form.xpReward) : 0,
        };
        await client.adminGamification.quests.create(input);
      }
      closeForm();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : dict.admin.quests.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (quest: Quest) => {
    const next = !quest.active;
    // Optimistic update — revert on failure.
    setQuests((prev) => prev.map((q) => (q.id === quest.id ? { ...q, active: next } : q)));
    try {
      await client.adminGamification.quests.update(quest.id, { active: next });
    } catch (e) {
      setQuests((prev) => prev.map((q) => (q.id === quest.id ? { ...q, active: quest.active } : q)));
      setError(e instanceof Error ? e.message : dict.admin.quests.saveError);
    }
  };

  const handleDelete = async (quest: Quest) => {
    if (!window.confirm(dict.admin.quests.deleteConfirm(quest.title))) return;
    try {
      await client.adminGamification.quests.delete(quest.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.quests.deleteError);
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
            {dict.admin.quests.title}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{dict.admin.quests.subtitle}</p>
        </div>
        <Button onClick={openCreate} variant="primary" size="md">
          {dict.admin.quests.newButton}
        </Button>
      </div>

      <div className="p-6 space-y-6">
        <p className="rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {dict.admin.quests.periodWarning}
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
              {editingId ? dict.admin.quests.editTitle : dict.admin.quests.createTitle}
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                  {dict.admin.quests.fields.kind}
                </span>
                <select
                  value={form.kind}
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as QuestKind }))}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="daily">{dict.admin.quests.kindDaily}</option>
                  <option value="weekly">{dict.admin.quests.kindWeekly}</option>
                </select>
              </label>
              <Input
                label={dict.admin.quests.fields.title}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.quests.fields.predicateKind}
                value={form.predicateKind}
                onChange={(e) => setForm((f) => ({ ...f, predicateKind: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.quests.fields.xpReward}
                type="number"
                value={form.xpReward}
                onChange={(e) => setForm((f) => ({ ...f, xpReward: e.target.value }))}
                disabled={!canEditEconomy}
                helperText={!canEditEconomy ? dict.admin.quests.xpRewardAdminOnly : undefined}
              />
            </div>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {dict.admin.quests.fields.description}
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
                {dict.admin.quests.fields.predicateParams}
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
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{dict.admin.quests.predicateParamsPreview}</p>
                  <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">{predicateParamsPreview.value}</pre>
                </div>
              ) : (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{dict.admin.quests.predicateParamsInvalid}</p>
              )
            )}

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              {dict.admin.quests.fields.active}
            </label>

            {formError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex justify-end gap-3">
              <Button type="button" onClick={closeForm} variant="secondary" size="md">
                {dict.admin.quests.cancelButton}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={saving} isLoading={saving}>
                {saving ? dict.admin.quests.savingButton : dict.admin.quests.saveButton}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : quests.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{dict.admin.quests.empty}</p>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.kind} aria-label={kindLabel(group.kind)}>
                <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {group.kind === 'daily' ? dict.admin.quests.dailyHeading : dict.admin.quests.weeklyHeading}
                </h2>
                {group.items.length === 0 ? (
                  <p className="py-4 text-sm text-zinc-500">{dict.admin.quests.groupEmpty}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-900">
                        <tr>
                          <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.quests.columns.title}</th>
                          <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.quests.columns.predicate}</th>
                          <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.quests.columns.xpReward}</th>
                          <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.quests.columns.active}</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((quest) => (
                          <tr key={quest.id} className="border-t border-zinc-200 dark:border-zinc-800">
                            <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{quest.title}</td>
                            <td className="px-4 py-2"><span className="font-mono text-xs">{quest.predicateKind} {quest.predicateParams}</span></td>
                            <td className="px-4 py-2">{quest.xpReward}</td>
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => handleToggleActive(quest)}
                                aria-label={quest.active ? dict.admin.quests.deactivate : dict.admin.quests.activate}
                              >
                                <BadgePill status={quest.active ? 'active' : 'inactive'} size="sm">
                                  {quest.active ? dict.admin.quests.activeLabel : dict.admin.quests.inactiveLabel}
                                </BadgePill>
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button type="button" onClick={() => openEdit(quest)} variant="secondary" size="sm">
                                  {dict.admin.quests.editButton}
                                </Button>
                                <Button type="button" onClick={() => handleDelete(quest)} variant="danger" size="sm">
                                  {dict.admin.quests.deleteButton}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
