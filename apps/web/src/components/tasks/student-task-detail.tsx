'use client';

import Link from 'next/link';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import type { PublicTaskDetail } from '@web/lib/tasks-api';

export function StudentTaskDetail({ task }: { task: PublicTaskDetail }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      <Link href="/tasks" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Back to tasks
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">{task.title}</h1>
      </header>

      {task.description && (
        <section className="mb-8">
          <MarkdownViewer content={task.description} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stages</h2>
        {task.stages.length === 0 ? (
          <p className="text-sm text-zinc-500">No stages yet.</p>
        ) : (
          <ol className="space-y-3" data-testid="stages-list">
            {task.stages.map((stage, idx) => (
              <li
                key={stage.id}
                className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Stage {idx + 1}
                  </span>
                  <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                    {stage.label}
                  </h3>
                </div>
                {stage.topics.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Topics for ${stage.label}`}>
                    {stage.topics.map((topic) => (
                      <li key={topic.id}>
                        <Link
                          href={`/catalog/${topic.id}`}
                          className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                        >
                          {topic.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
