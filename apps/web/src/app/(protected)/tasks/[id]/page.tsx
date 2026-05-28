'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { StudentTaskDetail } from '@web/components/tasks/student-task-detail';
import type { PublicTaskDetail } from '@web/lib/tasks-api';

export const runtime = 'edge';

export default function StudentTaskDetailPage() {
  const dict = useDict();
  const params = useParams<{ id: string }>();
  const client = useApiClient();
  const [task, setTask] = useState<PublicTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!params.id) return;
    try {
      setTask(await client.tasks.getById(params.id));
    } catch {
      setError(dict.tasks.detail.loadError);
    }
  }, [client, params.id, dict]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void reload();
  }, [reload]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p role="alert" className="rounded-md px-4 py-3 text-sm" style={{ background: 'var(--error-bg)', color: 'var(--error)' }}>
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
