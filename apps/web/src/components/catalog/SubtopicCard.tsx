import Link from 'next/link';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';

type Props = {
  topicId: string;
  subtopic: TopicNode;
  index: number;
  status: TopicProgressStatus;
  showInstructorUI: boolean;
};

const STATUS_CONFIG: Record<TopicProgressStatus, { label: string; bg: string; color: string; stripe: string }> = {
  completed: {
    label: 'Concluído',
    bg: 'oklch(0.68 0.17 150 / 0.15)',
    color: 'var(--aq-accent3)',
    stripe: 'var(--aq-accent3)',
  },
  in_progress: {
    label: 'Em andamento',
    bg: 'var(--aq-accent-glow)',
    color: 'var(--aq-accent)',
    stripe: 'var(--aq-accent)',
  },
  not_started: {
    label: 'Não iniciado',
    bg: 'var(--aq-bg4)',
    color: 'var(--aq-text3)',
    stripe: 'transparent',
  },
};

const PCT: Record<TopicProgressStatus, number> = {
  completed: 100,
  in_progress: 50,
  not_started: 0,
};

function EditIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M8 1.5l1.5 1.5L3.5 9H2V7.5L8 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M1.5 3h8M4.5 3V2h2v1M2.5 3l.5 6.5h5L9 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SubtopicCard({ topicId, subtopic, index, status, showInstructorUI }: Props) {
  const config = STATUS_CONFIG[status];
  const pct = PCT[status];

  return (
    <Link
      href={`/catalog/${topicId}/${subtopic.id}`}
      className="relative flex items-center gap-5 overflow-hidden rounded-[14px] px-6 py-5 transition-transform duration-200 hover:translate-x-[3px]"
      style={{
        background: 'var(--aq-bg2)',
        border: '1px solid var(--aq-border)',
        boxShadow: 'var(--aq-card-shadow, 0 2px 12px rgba(0,0,0,0.15))',
      }}
    >
      {/* Left accent stripe */}
      <div
        className="absolute bottom-0 left-0 top-0 w-1 rounded-[4px_0_0_4px]"
        style={{ background: config.stripe }}
      />

      {/* Number badge */}
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold"
        style={
          status === 'completed'
            ? { background: 'var(--aq-accent3)', color: 'white' }
            : status === 'in_progress'
            ? { background: 'var(--aq-accent)', color: '#0B0E17' }
            : { background: 'var(--aq-bg3)', color: 'var(--aq-text3)', border: '1px solid var(--aq-border2)' }
        }
        aria-hidden
      >
        {status === 'completed' ? '✓' : index + 1}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold" style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}>
          {subtopic.title}
        </p>
        {subtopic.content && (
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--aq-text2)' }}>
            {subtopic.content.replace(/[#*`_[\]]/g, '').slice(0, 80).trim()}…
          </p>
        )}
        {subtopic.tags && subtopic.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {subtopic.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex flex-shrink-0 flex-col items-end gap-2" style={{ minWidth: 100 }}>
        {showInstructorUI && (
          <div className="flex gap-1.5" onClick={(e) => e.preventDefault()}>
            <button
              type="button"
              title="Edit"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors"
              style={{ border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text3)' }}
            >
              <EditIcon />
            </button>
            <button
              type="button"
              title="Delete"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors"
              style={{ border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text3)' }}
            >
              <TrashIcon />
            </button>
          </div>
        )}
        <div className="w-full">
          <p className="mb-1 text-right text-[11px]" style={{ color: 'var(--aq-text3)' }}>{pct}%</p>
          <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--aq-bg4)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: config.stripe || 'var(--aq-accent)' }}
            />
          </div>
        </div>
        <span
          className="rounded-[10px] px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ background: config.bg, color: config.color }}
        >
          {config.label}
        </span>
      </div>
    </Link>
  );
}
