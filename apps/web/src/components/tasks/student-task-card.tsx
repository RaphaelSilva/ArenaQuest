'use client';

import Link from 'next/link';
import type { TaskSummary } from '@web/lib/tasks-api';

export function StudentTaskCard({ task }: { task: TaskSummary }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      data-testid={`task-card-${task.id}`}
      className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4 transition hover:border-emerald-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
    >
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{task.title}</h3>
      <p className="text-xs text-zinc-500">
        {task.stageCount} {task.stageCount === 1 ? 'stage' : 'stages'} · {task.topicCount}{' '}
        {task.topicCount === 1 ? 'topic' : 'topics'}
      </p>
      <span className="mt-2 self-start text-sm font-medium text-emerald-600 hover:text-emerald-700">
        Explore →
      </span>
    </Link>
  );
}
