'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@web/hooks/use-auth';
import { progressApi, type ProgressSummary, type TaskProgressItem } from '@web/lib/progress-api';
import { topicsApi } from '@web/lib/topics-api';
import { tasksApi, type TaskSummary } from '@web/lib/tasks-api';
import { computeRootRollups, type RootRollup } from '@web/lib/topic-rollup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardData = {
  summary: ProgressSummary;
  rollups: RootRollup[];
  inProgressTasks: Array<TaskProgressItem & { task: TaskSummary }>;
};

const CACHE_KEY = 'aq_dashboard_v1';

// ---------------------------------------------------------------------------
// SWR-like hook: return cached data immediately, revalidate in background
// ---------------------------------------------------------------------------

function useDashboardData(token: string | null) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) setData(JSON.parse(raw) as DashboardData);
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const [summary, topicProgress, taskProgress, topics, tasks] = await Promise.all([
        progressApi.getSummary(token),
        progressApi.getTopics(token),
        progressApi.getTasks(token),
        topicsApi.list(token),
        tasksApi.list(token),
      ]);

      const rollups = computeRootRollups(topics, topicProgress);

      const taskMap = new Map(tasks.map((t) => [t.id, t]));
      const inProgressTasks = taskProgress
        .filter((tp) => tp.status === 'in_progress')
        .map((tp) => {
          const task = taskMap.get(tp.taskId);
          return task ? { ...tp, task } : null;
        })
        .filter((tp): tp is TaskProgressItem & { task: TaskSummary } => tp !== null);

      const fresh: DashboardData = { summary, rollups, inProgressTasks };
      setData(fresh);
      setError(null);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
      } catch {
        // storage quota — ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o dashboard.');
    } finally {
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (hydrated && token) {
      void refresh();
    }
  }, [hydrated, token, refresh]);

  const isLoading = !hydrated || (!data && isRefreshing);

  return { data, isLoading, isRefreshing, error, refresh };
}

// ---------------------------------------------------------------------------
// ProgressRing — SVG circle-based ring, no external libs
// ---------------------------------------------------------------------------

type ProgressRingProps = {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  label: string;
};

export function ProgressRing({ percentage, size = 60, strokeWidth = 5, color, label }: ProgressRingProps) {
  const capped = Math.min(100, Math.max(0, percentage));
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (capped / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label={`${label}: ${capped}%`}
    >
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--bg4)" strokeWidth={strokeWidth} />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="'Space Grotesk', sans-serif"
        fill={color}
      >
        {capped}%
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SummaryCard
// ---------------------------------------------------------------------------

type SummaryCardProps = {
  label: string;
  icon: string;
  accentColor: string;
  children: React.ReactNode;
  delay?: number;
};

function SummaryCard({ label, icon, accentColor, children, delay = 0 }: SummaryCardProps) {
  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-5 transition-colors duration-200"
      style={{
        background: 'var(--bg2)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-sm)',
        animationDelay: `${delay}ms`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl"
        style={{ background: accentColor }}
      />
      <div className="mb-3 flex items-center justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-[1px]"
          style={{ color: 'var(--text3)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {label}
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-base"
          style={{ background: `${accentColor}1a` }}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      {children}
    </article>
  );
}

// ---------------------------------------------------------------------------
// ContinueSection
// ---------------------------------------------------------------------------

type ContinueSectionProps = {
  items: Array<TaskProgressItem & { task: TaskSummary }>;
};

function ContinueSection({ items }: ContinueSectionProps) {
  if (items.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
        aria-label="Continuar aprendendo"
      >
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Nenhuma missão em andamento. Comece uma missão na aba de tarefas!
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Continuar aprendendo">
      <ul className="flex flex-col gap-3">
        {items.map((item, idx) => (
          <li key={item.taskId}>
            <Link
              href={`/tasks/${item.taskId}`}
              className="group flex items-center gap-4 rounded-xl border px-4 py-3 transition-all duration-150"
              style={{
                background: 'var(--bg2)',
                borderColor: 'var(--border)',
                animationDelay: `${idx * 60}ms`,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
                aria-hidden
              >
                🎯
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium"
                  style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {item.task.title}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text3)' }}>
                  {item.task.stageCount} etapa{item.task.stageCount !== 1 ? 's' : ''} · Em andamento
                </p>
              </div>
              <span
                className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
              >
                Continuar →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// TopicBreakdown
// ---------------------------------------------------------------------------

type TopicBreakdownProps = {
  rollups: RootRollup[];
};

const RING_COLORS = [
  'var(--accent)',
  'var(--accent2)',
  'var(--accent3)',
  'var(--accent4)',
];

function TopicBreakdown({ rollups }: TopicBreakdownProps) {
  if (rollups.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
        aria-label="Progresso por tópico"
      >
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Nenhum tópico atribuído ainda. Entre em contato com seu instrutor.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Progresso por tópico">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rollups.map((rollup, idx) => {
          const color = RING_COLORS[idx % RING_COLORS.length];
          return (
            <li
              key={rollup.rootId}
              className="flex items-center gap-4 rounded-xl border px-4 py-4 transition-colors duration-200"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            >
              <ProgressRing
                percentage={rollup.percentage}
                size={60}
                strokeWidth={5}
                color={color}
                label={rollup.title}
              />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-semibold"
                  style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {rollup.title}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text3)' }}>
                  {rollup.completed} / {rollup.total} concluídos
                </p>
                {/* Accessible numeric equivalent alongside ring */}
                <div
                  className="mt-2 h-[3px] overflow-hidden rounded-full"
                  style={{ background: 'var(--bg4)' }}
                  role="progressbar"
                  aria-label={`${rollup.title}: ${rollup.percentage}% concluído`}
                  aria-valuenow={rollup.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rollup.percentage}%`,
                      background: color,
                      transition: 'width 0.8s ease',
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      className="h-32 animate-pulse rounded-2xl"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    />
  );
}

// ---------------------------------------------------------------------------
// DashboardClient
// ---------------------------------------------------------------------------

export function DashboardClient() {
  const { accessToken, user } = useAuth();
  const { data, isLoading, error } = useDashboardData(accessToken);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  const firstName = user?.name?.split(' ')[0] ?? '';

  const lastActivityLabel = (() => {
    if (!data?.summary.lastActivityAt) return 'Nenhuma atividade';
    const d = new Date(data.summary.lastActivityAt);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  })();

  return (
    <div
      className="flex flex-col gap-6"
      style={{ padding: '28px 32px 40px' }}
    >
      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-[22px] font-bold tracking-tight"
            style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.3px' }}
          >
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text2)' }}>
            Acompanhe seu progresso e continue de onde parou.
          </p>
        </div>
        <time
          className="hidden text-right text-xs sm:block"
          style={{ color: 'var(--text3)' }}
          dateTime={new Date().toISOString().slice(0, 10)}
        >
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })}
        </time>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </div>
      )}

      {/* Summary Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <SummaryCard
              label="Tópicos"
              icon="📚"
              accentColor="var(--accent3)"
              delay={0}
            >
              <div
                className="text-[36px] font-bold leading-none"
                style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
                aria-label={`${data?.summary.topics.percentage ?? 0}% de tópicos concluídos`}
              >
                {data?.summary.topics.percentage ?? 0}
                <span className="text-sm font-medium ml-1" style={{ color: 'var(--text3)' }}>%</span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text3)' }}>
                {data?.summary.topics.completed ?? 0} de {data?.summary.topics.total ?? 0} concluídos
              </p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--bg4)' }}
                role="progressbar"
                aria-label="Progresso de tópicos"
                aria-valuenow={data?.summary.topics.percentage ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${data?.summary.topics.percentage ?? 0}%`,
                    background: 'linear-gradient(90deg, var(--accent3), var(--accent2))',
                    transition: 'width 0.8s ease',
                  }}
                />
              </div>
            </SummaryCard>

            <SummaryCard
              label="Missões"
              icon="🎯"
              accentColor="var(--accent)"
              delay={80}
            >
              <div
                className="text-[36px] font-bold leading-none"
                style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
                aria-label={`${data?.summary.tasks.percentage ?? 0}% de missões concluídas`}
              >
                {data?.summary.tasks.percentage ?? 0}
                <span className="text-sm font-medium ml-1" style={{ color: 'var(--text3)' }}>%</span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text3)' }}>
                {data?.summary.tasks.completed ?? 0} de {data?.summary.tasks.total ?? 0} completas
              </p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--bg4)' }}
                role="progressbar"
                aria-label="Progresso de missões"
                aria-valuenow={data?.summary.tasks.percentage ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${data?.summary.tasks.percentage ?? 0}%`,
                    background: 'linear-gradient(90deg, var(--accent), var(--accent2))',
                    transition: 'width 0.8s ease',
                  }}
                />
              </div>
            </SummaryCard>

            <SummaryCard
              label="Última atividade"
              icon="⏱️"
              accentColor="var(--accent2)"
              delay={160}
            >
              <div
                className="text-lg font-bold"
                style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
                aria-label={`Última atividade: ${lastActivityLabel}`}
              >
                {lastActivityLabel}
              </div>
              {data?.summary.lastActivityAt && (
                <p className="mt-2 text-xs" style={{ color: 'var(--text3)' }}>
                  {data.summary.topics.inProgress} tópico{data.summary.topics.inProgress !== 1 ? 's' : ''} em andamento
                </p>
              )}
            </SummaryCard>
          </>
        )}
      </div>

      {/* Continue Learning */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2
            className="flex items-center gap-2 text-[13px] font-semibold"
            style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Continuar aprendendo
            {data && data.inProgressTasks.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
              >
                {data.inProgressTasks.length}
              </span>
            )}
          </h2>
          <Link
            href="/tasks"
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            Ver todas →
          </Link>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--bg3)' }} />
              ))}
            </div>
          ) : (
            <ContinueSection items={data?.inProgressTasks ?? []} />
          )}
        </div>
      </div>

      {/* Topic Breakdown */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2
            className="text-[13px] font-semibold"
            style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Trilha de aprendizado
          </h2>
          {data && data.rollups.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text3)' }}>
              {data.rollups.filter((r) => r.percentage === 100).length} de {data.rollups.length} módulos concluídos
            </span>
          )}
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: 'var(--bg3)' }} />
              ))}
            </div>
          ) : (
            <TopicBreakdown rollups={data?.rollups ?? []} />
          )}
        </div>
      </div>
    </div>
  );
}
