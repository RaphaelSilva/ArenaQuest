'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Badge as BadgePill, Button, Input } from '@web/components/design-system';
import type { Badge, CreateBadgeInput } from '@web/lib/admin-gamification-api';

type FormState = {
  name: string;
  slug: string;
  iconEmoji: string;
  description: string;
  ruleKind: string;
  ruleParams: string;
  xpReward: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  iconEmoji: '',
  description: '',
  ruleKind: '',
  ruleParams: '',
  xpReward: '',
  active: true,
};

export default function AdminBadgesPage() {
  const dict = useDict();
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canEditEconomy = useHasRole(ROLES.ADMIN);

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
      const list = await client.adminGamification.badges.list();
      setBadges(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.badges.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, dict.admin.badges.loadError]);

  useEffect(() => {
    if (!authLoading && !canAuthor) {
      router.replace('/dashboard');
      return;
    }
    if (canAuthor) void reload();
  }, [authLoading, canAuthor, reload, router]);

  const ruleParamsPreview = useMemo(() => {
    if (!form.ruleParams.trim()) return { ok: true as const, value: null };
    try {
      return { ok: true as const, value: JSON.stringify(JSON.parse(form.ruleParams), null, 2) };
    } catch {
      return { ok: false as const, value: null };
    }
  }, [form.ruleParams]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (badge: Badge) => {
    setEditingId(badge.id);
    setForm({
      name: badge.name,
      slug: badge.slug,
      iconEmoji: badge.iconEmoji,
      description: badge.description ?? '',
      ruleKind: badge.ruleKind,
      ruleParams: badge.ruleParams ?? '',
      xpReward: badge.xpReward != null ? String(badge.xpReward) : '',
      active: badge.active,
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
    if (!ruleParamsPreview.ok) {
      setFormError(dict.admin.badges.ruleParamsInvalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    const xpReward = form.xpReward.trim() ? Number(form.xpReward) : undefined;
    try {
      if (editingId) {
        await client.adminGamification.badges.update(editingId, {
          name: form.name,
          iconEmoji: form.iconEmoji,
          description: form.description || undefined,
          ruleKind: form.ruleKind,
          ruleParams: form.ruleParams || undefined,
          active: form.active,
          ...(canEditEconomy ? { xpReward } : {}),
        });
      } else {
        const input: CreateBadgeInput = {
          slug: form.slug,
          name: form.name,
          iconEmoji: form.iconEmoji,
          description: form.description || undefined,
          ruleKind: form.ruleKind,
          ruleParams: form.ruleParams || undefined,
          ...(canEditEconomy ? { xpReward } : {}),
        };
        await client.adminGamification.badges.create(input);
      }
      closeForm();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : dict.admin.badges.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (badge: Badge) => {
    try {
      await client.adminGamification.badges.update(badge.id, { active: !badge.active });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.badges.saveError);
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
            {dict.admin.badges.title}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{dict.admin.badges.subtitle}</p>
        </div>
        <Button onClick={openCreate} variant="primary" size="md">
          {dict.admin.badges.newButton}
        </Button>
      </div>

      <div className="p-6 space-y-6">
        <p className="rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {dict.admin.badges.periodWarning}
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
              {editingId ? dict.admin.badges.editTitle : dict.admin.badges.createTitle}
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={dict.admin.badges.fields.name}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.badges.fields.slug}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                disabled={editingId != null}
                required
              />
              <Input
                label={dict.admin.badges.fields.iconEmoji}
                value={form.iconEmoji}
                onChange={(e) => setForm((f) => ({ ...f, iconEmoji: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.badges.fields.ruleKind}
                value={form.ruleKind}
                onChange={(e) => setForm((f) => ({ ...f, ruleKind: e.target.value }))}
                required
              />
              <Input
                label={dict.admin.badges.fields.xpReward}
                type="number"
                value={form.xpReward}
                onChange={(e) => setForm((f) => ({ ...f, xpReward: e.target.value }))}
                disabled={!canEditEconomy}
                helperText={!canEditEconomy ? dict.admin.badges.xpRewardAdminOnly : undefined}
              />
            </div>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {dict.admin.badges.fields.description}
              </span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {dict.admin.badges.fields.ruleParams}
              </span>
              <textarea
                value={form.ruleParams}
                onChange={(e) => setForm((f) => ({ ...f, ruleParams: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            {form.ruleParams.trim() && (
              ruleParamsPreview.ok ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{dict.admin.badges.ruleParamsPreview}</p>
                  <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">{ruleParamsPreview.value}</pre>
                </div>
              ) : (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{dict.admin.badges.ruleParamsInvalid}</p>
              )
            )}

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              {dict.admin.badges.fields.active}
            </label>

            {formError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex justify-end gap-3">
              <Button type="button" onClick={closeForm} variant="secondary" size="md">
                {dict.admin.badges.cancelButton}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={saving} isLoading={saving}>
                {saving ? dict.admin.badges.savingButton : dict.admin.badges.saveButton}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : badges.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{dict.admin.badges.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.icon}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.name}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.slug}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.rule}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.xpReward}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.badges.columns.active}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {badges.map((badge) => (
                  <tr key={badge.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2 text-lg">{badge.iconEmoji}</td>
                    <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{badge.name}</td>
                    <td className="px-4 py-2"><code className="font-mono text-xs">{badge.slug}</code></td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs">{badge.ruleKind}{badge.ruleParams ? ` ${badge.ruleParams}` : ''}</span>
                    </td>
                    <td className="px-4 py-2">{badge.xpReward ?? '—'}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(badge)}
                        aria-label={badge.active ? dict.admin.badges.deactivate : dict.admin.badges.activate}
                      >
                        <BadgePill status={badge.active ? 'active' : 'inactive'} size="sm">
                          {badge.active ? dict.admin.badges.activeLabel : dict.admin.badges.inactiveLabel}
                        </BadgePill>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button type="button" onClick={() => openEdit(badge)} variant="secondary" size="sm">
                        {dict.admin.badges.editButton}
                      </Button>
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
