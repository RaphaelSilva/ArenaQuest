import type { DashboardMission } from '@web/lib/dashboard-api';

type Props = { missions: DashboardMission[] | null };

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function MissionsList({ missions }: Props) {
  if (!missions || missions.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label="Special missions"
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          No active missions right now.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Special missions">
      <h2
        className="mb-3 text-[13px] font-semibold"
        style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
      >
        Special Missions
      </h2>
      <ul className="flex flex-col gap-3">
        {missions.map((m) => (
          <li
            key={m.id}
            className="overflow-hidden rounded-2xl border p-4"
            style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-2xl" aria-hidden>{m.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className="truncate text-sm font-semibold"
                    style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {m.name}
                  </p>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
                  >
                    +{m.rewardXp} XP
                  </span>
                </div>

                <p className="mt-0.5 text-xs line-clamp-1" style={{ color: 'var(--aq-text3)' }}>
                  {m.description}
                </p>

                <div className="mt-2 flex items-center gap-2">
                  <div
                    className="flex-1 h-1.5 overflow-hidden rounded-full"
                    style={{ background: 'var(--aq-bg4)' }}
                    role="progressbar"
                    aria-label={`${m.name}: ${m.progressPct}% complete`}
                    aria-valuenow={m.progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${m.progressPct}%`, background: 'var(--aq-accent)' }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                    {m.progressPct}%
                  </span>
                </div>

                <p className="mt-1 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                  Ends {formatDeadline(m.deadlineAt)}
                  {m.rewardBadge && (
                    <span className="ml-2">· Badge: {m.rewardBadge}</span>
                  )}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
