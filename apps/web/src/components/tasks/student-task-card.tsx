'use client';

import Link from 'next/link';
import type { TaskSummary } from '@web/lib/tasks-api';

export function StudentTaskCard({ task }: { task: TaskSummary }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      data-testid={`task-card-${task.id}`}
      className="flex flex-col gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg2)] p-4 transition hover:border-[color:var(--accent)] hover:shadow-sm dark:hover:shadow-sm"
    >
      <h3 className="text-base font-semibold text-[color:var(--text)]">{task.title}</h3>
      <p className="text-xs text-[color:var(--text2)]">
        {task.stageCount} {task.stageCount === 1 ? 'stage' : 'stages'} · {task.topicCount}{' '}
        {task.topicCount === 1 ? 'topic' : 'topics'}
      </p>
      <span className="mt-2 self-start text-sm font-medium text-[color:var(--accent)] hover:opacity-80 transition-opacity">
        Explore →
      </span>
    </Link>
  );
}
