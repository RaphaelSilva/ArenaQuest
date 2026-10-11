'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Badge as BadgePill, Button } from '@web/components/design-system';
import type { Badge, MissionListItem } from '@web/lib/admin-gamification-api';

/** `YYYY-MM-DD HH:mm` of an ISO instant, locale-agnostic (i18n-spec §3.5). */
const shortInstant = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

/**
 * The missions list. Reads are open to admins and content creators; creating,
 * editing and deleting are admin-only, so a content creator sees the table
 * with no write control and opens each mission read-only.
 */
export default function AdminMissionsPage() {
  const dict = useDict();
  const d = dict.admin.missions;
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canWrite = useHasRole(ROLES.ADMIN);

  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch {
      setError(d.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, d.loadError]);

  useEffect(() => {
    if (!authLoading && !canAccess) {
      router.replace('/dashboard');
      return;
    }
    if (canAccess) void reload();
  }, [authLoading, canAccess, reload, router]);

  const badgeName = useCallback(
    (id: string | null) => badges.find((b) => b.id === id)?.name ?? d.noBadge,
    [badges, d.noBadge],
  );

  const handleDelete = async (mission: MissionListItem) => {
    if (!window.confirm(d.deleteConfirm(mission.title))) return;
    try {
      await client.adminGamification.missions.delete(mission.id);
      await reload();
    } catch {
      setError(d.deleteError);
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8 text-[color:var(--text3)]" />
      </div>
    );
  }
  if (!canAccess) return null;

  const th = 'px-4 py-2 text-xs font-semibold uppercase tracking-wider';
  const thStyle = { color: 'var(--text3)' };

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div>
          <h1
            className="text-[28px] font-bold"
            style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
          >
            {d.title}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {d.subtitle}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => router.push('/admin/missions/new')} variant="primary" size="md">
            {d.newButton}
          </Button>
        )}
      </div>

      <div className="space-y-6 p-6">
        {!canWrite && (
          <p className="rounded-lg px-4 py-2 text-sm" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
            {d.readOnlyNotice}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-[color:var(--text3)]" />
          </div>
        ) : missions.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>
            {d.empty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[14px] border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left text-sm">
              <thead style={{ background: 'var(--bg2)' }}>
                <tr>
                  <th className={th} style={thStyle}>{d.columns.title}</th>
                  <th className={th} style={thStyle}>{d.columns.window}</th>
                  <th className={th} style={thStyle}>{d.columns.mode}</th>
                  <th className={th} style={thStyle}>{d.columns.enrollment}</th>
                  <th className={th} style={thStyle}>{d.columns.steps}</th>
                  <th className={th} style={thStyle}>{d.columns.participants}</th>
                  <th className={th} style={thStyle}>{d.columns.xpReward}</th>
                  <th className={th} style={thStyle}>{d.columns.badge}</th>
                  <th className={th} style={thStyle}>{d.columns.active}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {missions.map((mission) => {
                  const href = `/admin/missions/${mission.id}`;
                  return (
                    <tr
                      key={mission.id}
                      onClick={() => router.push(href)}
                      className="cursor-pointer border-t transition-colors duration-150 hover:bg-[color:var(--bg3)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                    >
                      <td className="px-4 py-2 font-medium" style={{ color: 'var(--text)' }}>
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:underline">
                          {mission.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {d.windowRange(shortInstant(mission.startAt), shortInstant(mission.endAt))}
                      </td>
                      <td className="px-4 py-2">{d.modeOptions[mission.mode]}</td>
                      <td className="px-4 py-2">{d.enrollmentOptions[mission.enrollmentMode]}</td>
                      <td className="px-4 py-2">
                        {mission.requirementCount > 0 ? mission.requirementCount : d.legacyLabel}
                      </td>
                      <td className="px-4 py-2">{d.enrolledCompleted(mission.enrolledCount, mission.completedCount)}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--accent)', fontFamily: "'Space Grotesk', sans-serif" }}>
                        {mission.xpReward}
                      </td>
                      <td className="px-4 py-2">{badgeName(mission.badgeId)}</td>
                      <td className="px-4 py-2">
                        <BadgePill status={mission.active ? 'active' : 'inactive'} size="sm">
                          {mission.active ? d.activeLabel : d.inactiveLabel}
                        </BadgePill>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(href);
                            }}
                            variant="secondary"
                            size="sm"
                          >
                            {canWrite ? d.editButton : d.viewButton}
                          </Button>
                          {canWrite && (
                            <Button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDelete(mission);
                              }}
                              variant="danger"
                              size="sm"
                            >
                              {d.deleteButton}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
