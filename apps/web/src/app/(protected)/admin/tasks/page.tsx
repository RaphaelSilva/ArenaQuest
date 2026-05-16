'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { adminTasksApi, type Task } from '@web/lib/admin-tasks-api';
import { Button, Badge } from '@web/components/design-system';

export default function AdminTasksPage() {
  const router = useRouter();
  const { accessToken: token } = useAuth();
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
    <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.3px' }}>Tasks</h1>
        <Button
          onClick={handleCreate}
          disabled={creating}
          variant="primary"
          size="md"
          isLoading={creating}
        >
          {creating ? 'Creating…' : 'New Task'}
        </Button>
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
                <Badge status={task.status as 'draft' | 'published' | 'archived'} size="sm">
                  {task.status}
                </Badge>
              </div>
              <span className="text-xs text-zinc-500">{new Date(task.updatedAt).toLocaleDateString()}</span>
              {task.status !== 'archived' && (
                confirmingArchive === task.id ? (
                  <span className="flex items-center gap-2">
                    <Button
                      onClick={() => handleArchive(task.id)}
                      variant="danger"
                      size="sm"
                    >
                      Confirm
                    </Button>
                    <Button
                      onClick={() => setConfirmingArchive(null)}
                      variant="secondary"
                      size="sm"
                    >
                      Cancel
                    </Button>
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
