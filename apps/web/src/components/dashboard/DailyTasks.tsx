import type { DailyQuest } from '@web/lib/dashboard-api';

type Props = { tasks: DailyQuest[] };

export function DailyTasks({ tasks }: Props) {
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label="Daily tasks"
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          No daily tasks today.
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label="Daily tasks"
    >
      <div
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        <h2
          className="flex items-center gap-2 text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Today&apos;s Tasks
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
          >
            {completed}/{total}
          </span>
        </h2>
        <span className="text-xs font-medium" style={{ color: 'var(--aq-accent)' }}>
          {pct}%
        </span>
      </div>

      <div className="px-5 pt-3 pb-1">
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--aq-bg4)' }}
          role="progressbar"
          aria-label="Daily task progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: 'var(--aq-accent)' }}
          />
        </div>
      </div>

      <ul className="divide-y px-5 pb-4" style={{ borderColor: 'var(--aq-border)' }}>
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-3">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
              style={
                task.completed
                  ? { background: 'var(--aq-accent)', borderColor: 'var(--aq-accent)', color: '#000' }
                  : { background: 'transparent', borderColor: 'var(--aq-border3)', color: 'transparent' }
              }
              aria-hidden
            >
              {task.completed && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>

            <span
              className="flex-1 text-sm"
              style={{
                color: task.completed ? 'var(--aq-text3)' : 'var(--aq-text)',
                textDecoration: task.completed ? 'line-through' : 'none',
              }}
            >
              {task.title}
            </span>

            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
            >
              +{task.xpReward} XP
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
