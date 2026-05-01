'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { StudentTaskDetail } from '@web/components/tasks/student-task-detail';
import { tasksApi, type PublicTaskDetail } from '@web/lib/tasks-api';

export default function StudentTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const { token } = useAuth();
  const [task, setTask] = useState<PublicTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token || !params.id) return;
    try {
      setTask(await tasksApi.getById(token, params.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load task');
    }
  }, [token, params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void reload();
  }, [reload]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p role="alert" className="rounded-md bg-red-100 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      </main>
    );
  }

  if (!task) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-6 w-6 text-zinc-400" />
      </div>
    );
  }

  return <StudentTaskDetail task={task} />;
}
