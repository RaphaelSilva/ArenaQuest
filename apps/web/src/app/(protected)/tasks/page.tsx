'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { StudentTaskCard } from '@web/components/tasks/student-task-card';
import { tasksApi, type TaskSummary } from '@web/lib/tasks-api';

export default function StudentTasksPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await tasksApi.list(token);
      setTasks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void reload();
  }, [reload]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Tasks</h1>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-100 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {tasks === null ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          No tasks are available right now. Check back soon!
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <StudentTaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </main>
  );
}
