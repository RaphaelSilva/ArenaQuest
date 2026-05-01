'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { adminTasksApi, type Task } from '@web/lib/admin-tasks-api';

const STATUS_STYLES: Record<Task['status'], string> = {
  draft: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  published: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  archived: 'bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

export default function AdminTasksPage() {
  const router = useRouter();
  const { token } = useAuth();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await adminTasksApi.list(token);
      setTasks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    }
  }, [token]);

  useEffect(() => {
    if (!canAuthor) {
      router.replace('/dashboard');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void reload();
  }, [canAuthor, reload, router]);

  const handleCreate = async () => {
    if (!token) return;
    setCreating(true);
    try {
      const task = await adminTasksApi.create(token, { title: 'Untitled task' });
      router.push(`/admin/tasks/${task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!token) return;
    try {
      await adminTasksApi.archive(token, id);
      setConfirmingArchive(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive task');
    }
  };

  if (!canAuthor) return null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Tasks</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'New Task'}
        </button>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      {tasks === null ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">No tasks yet — create one to get started.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {tasks.map((task) => (
            <li key={task.id} data-testid={`task-row-${task.id}`} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex flex-1 items-center gap-3">
                <Link
                  href={`/admin/tasks/${task.id}`}
                  className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                >
                  {task.title}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[task.status]}`}>
                  {task.status}
                </span>
              </div>
              <span className="text-xs text-zinc-500">{new Date(task.updatedAt).toLocaleDateString()}</span>
              {task.status !== 'archived' && (
                confirmingArchive === task.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => handleArchive(task.id)}
                      className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingArchive(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-900"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingArchive(task.id)}
                    className="text-xs text-zinc-500 hover:text-red-600"
                  >
                    Archive
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
