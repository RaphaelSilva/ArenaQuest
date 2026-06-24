'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Button } from '@web/components/design-system';
import type { LevelDefinition } from '@web/lib/admin-gamification-api';

type Row = {
  level: string;
  rankTitle: string;
  minXp: string;
  maxXp: string;
};

function toRow(def: LevelDefinition): Row {
  return {
    level: String(def.level),
    rankTitle: def.rankTitle,
    minXp: String(def.minXp),
    maxXp: def.maxXp == null ? '' : String(def.maxXp),
  };
}

type Dict = ReturnType<typeof useDict>;

/**
 * Validates the curve client-side, mirroring the server invariant. Returns the
 * parsed rows when valid, or a localized error message when not.
 */
function validateCurve(
  rows: Row[],
  v: Dict['admin']['levels']['validation'],
): { ok: true; rows: LevelDefinition[] } | { ok: false; error: string } {
  if (rows.length === 0) return { ok: false, error: v.empty };

  const parsed: LevelDefinition[] = rows.map((r) => ({
    level: Number(r.level),
    rankTitle: r.rankTitle,
    minXp: Number(r.minXp),
    maxXp: r.maxXp.trim() === '' ? null : Number(r.maxXp),
  }));

  // Exactly one open-ended row, and it must be the last.
  const openIndexes = parsed.reduce<number[]>((acc, r, i) => (r.maxXp == null ? [...acc, i] : acc), []);
  if (openIndexes.length !== 1 || openIndexes[0] !== parsed.length - 1) {
    return { ok: false, error: v.singleOpenRow };
  }

  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];

    // Contiguous levels: each = previous + 1.
    if (i > 0 && row.level !== parsed[i - 1].level + 1) {
      return { ok: false, error: v.levelsContiguous };
    }

    // Strictly increasing minXp.
    if (i > 0 && !(row.minXp > parsed[i - 1].minXp)) {
      return { ok: false, error: v.minXpIncreasing };
    }

    if (i < parsed.length - 1) {
      // Non-final rows: maxXp must be > minXp and equal next row's minXp.
      if (row.maxXp == null || !(row.maxXp > row.minXp)) {
        return { ok: false, error: v.maxXpRange };
      }
      if (row.maxXp !== parsed[i + 1].minXp) {
        return { ok: false, error: v.maxXpGap };
      }
    }
  }

  return { ok: true, rows: parsed };
}

export default function AdminLevelsPage() {
  const dict = useDict();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const isAdmin = useHasRole(ROLES.ADMIN);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.adminGamification.levels.list();
      setRows(list.map(toRow));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.levels.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, dict.admin.levels.loadError]);

  useEffect(() => {
    if (!authLoading && isAdmin) void reload();
  }, [authLoading, isAdmin, reload]);

  const validation = useMemo(
    () => validateCurve(rows, dict.admin.levels.validation),
    [rows, dict.admin.levels.validation],
  );

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => {
      const lastLevel = prev.length > 0 ? Number(prev[prev.length - 1].level) : 0;
      return [...prev, { level: String(lastLevel + 1), rankTitle: '', minXp: '', maxXp: '' }];
    });
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!validation.ok) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await client.adminGamification.levels.replaceAll(validation.rows);
      setRows(saved.map(toRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.admin.levels.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex flex-1 flex-col overflow-y-auto p-6">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {dict.admin.levels.accessDenied}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h1 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
            {dict.admin.levels.title}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{dict.admin.levels.subtitle}</p>
        </div>
        <Button onClick={addRow} variant="secondary" size="md">
          {dict.admin.levels.addRow}
        </Button>
      </div>

      <div className="p-6 space-y-6">
        <p className="rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {dict.admin.levels.periodWarning}
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{dict.admin.levels.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.levels.columns.level}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.levels.columns.rankTitle}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.levels.columns.minXp}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.levels.columns.maxXp}</th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">{dict.admin.levels.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        aria-label={`${dict.admin.levels.columns.level} ${index + 1}`}
                        value={row.level}
                        onChange={(e) => updateRow(index, { level: e.target.value })}
                        className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        aria-label={`${dict.admin.levels.columns.rankTitle} ${index + 1}`}
                        value={row.rankTitle}
                        onChange={(e) => updateRow(index, { rankTitle: e.target.value })}
                        className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        aria-label={`${dict.admin.levels.columns.minXp} ${index + 1}`}
                        value={row.minXp}
                        onChange={(e) => updateRow(index, { minXp: e.target.value })}
                        className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        aria-label={`${dict.admin.levels.columns.maxXp} ${index + 1}`}
                        placeholder={dict.admin.levels.maxXpOpen}
                        value={row.maxXp}
                        onChange={(e) => updateRow(index, { maxXp: e.target.value })}
                        className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Button type="button" onClick={() => removeRow(index)} variant="danger" size="sm">
                        {dict.admin.levels.removeRow}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && !validation.ok && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{validation.error}</p>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            variant="primary"
            size="md"
            disabled={!validation.ok || saving}
            isLoading={saving}
          >
            {saving ? dict.admin.levels.savingButton : dict.admin.levels.saveButton}
          </Button>
        </div>
      </div>
    </main>
  );
}
