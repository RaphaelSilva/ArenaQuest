'use client';

import Link from 'next/link';
import type { TaskSummary } from '@web/lib/tasks-api';
import { useDict } from '@web/context/dict-context';

export function StudentTaskCard({ task }: { task: TaskSummary }) {
  const dict = useDict();
  return (
    <Link
      href={`/tasks/${task.id}`}
      data-testid={`task-card-${task.id}`}
      className="flex flex-col gap-2 rounded-[12px] border border-[color:var(--border)] bg-[color:var(--bg2)] p-4 transition hover:border-[color:var(--accent)] hover:shadow-sm dark:hover:shadow-sm"
    >
      <h3 className="text-base font-semibold text-[color:var(--text)]">{task.title}</h3>
      <p className="text-xs text-[color:var(--text2)]">
        {dict.tasks.card.stageCount(task.stageCount)} · {dict.tasks.card.topicCount(task.topicCount)}
      </p>
      <span className="mt-2 self-start text-sm font-medium text-[color:var(--accent)] hover:opacity-80 transition-opacity">
        {dict.tasks.card.explore}
      </span>
    </Link>
  );
}
