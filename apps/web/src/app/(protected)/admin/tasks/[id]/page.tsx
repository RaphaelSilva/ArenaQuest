'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { TaskTopicPicker } from '@web/components/tasks/task-topic-picker';
import { StageEditor } from '@web/components/tasks/stage-editor';
import { adminTopicsApi, type TopicNode } from '@web/lib/admin-topics-api';
import {
  AdminTasksApiError,
  adminTasksApi,
  type TaskDetail,
  type TaskStatus,
} from '@web/lib/admin-tasks-api';

const PUBLISH_REASONS: Record<string, string> = {
  NO_STAGES: 'Add at least one stage before publishing.',
  LINKED_TOPIC_NOT_PUBLISHED: 'Every linked topic must itself be published.',
};

export default function AdminTaskEditorPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const router = useRouter();
  const { token } = useAuth();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!token || !taskId) return;
    try {
      const [detail, topicList] = await Promise.all([
        adminTasksApi.getById(token, taskId),
        adminTopicsApi.list(token),
      ]);
      setTask(detail);
      setTitle(detail.title);
      setDescription(detail.description);
      setTopics(topicList);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load task');
    }
  }, [token, taskId]);

  useEffect(() => {
    if (!canAuthor) {
      router.replace('/dashboard');
      return;
    }
    void reload();
  }, [canAuthor, reload, router]);

  const handleSaveMeta = async () => {
    if (!token || !task) return;
    setSaving(true);
    setError(null);
    try {
      await adminTasksApi.update(token, task.id, { title, description });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSetStatus = async (status: TaskStatus) => {
    if (!token || !task) return;
    setPublishErrors([]);
    setError(null);
    try {
      await adminTasksApi.update(token, task.id, { status });
      await reload();
    } catch (e) {
      if (e instanceof AdminTasksApiError && e.code === 'TASK_NOT_PUBLISHABLE') {
        const reasons = (e.details.reasons as string[] | undefined) ?? [];
        setPublishErrors(reasons);
      } else if (e instanceof AdminTasksApiError && e.code === 'INVALID_TRANSITION') {
        setError('That status transition is not allowed.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to update status');
      }
    }
  };

  const handleTopicsChange = async (next: string[]) => {
    if (!token || !task) return;
    try {
      await adminTasksApi.setTaskTopics(token, task.id, next);
      await reload();
    } catch (e) {
      if (e instanceof AdminTasksApiError && e.code === 'LINKED_TOPIC_NOT_PUBLISHED') {
        setError('All linked topics must be published while the task is published.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to update topic links');
      }
    }
  };

  if (!canAuthor) return null;

  if (!task) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-6 w-6 text-zinc-400" />
      </div>
    );
  }

  const isDraft = task.status === 'draft';

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Link href="/admin/tasks" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Back to tasks
      </Link>

      <header className="mt-3 mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Edit Task</h1>
        <span
          data-testid="status-chip"
          className="rounded-full bg-zinc-200 px-3 py-1 text-xs uppercase tracking-wide text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
        >
          {task.status}
        </span>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      {publishErrors.length > 0 && (
        <div role="alert" data-testid="publish-errors" className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          <p className="font-medium">Cannot publish this task yet:</p>
          <ul className="mt-1 list-inside list-disc">
            {publishErrors.map((r) => (
              <li key={r}>{PUBLISH_REASONS[r] ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Description (Markdown)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        {description && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Preview</p>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <MarkdownViewer content={description} />
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveMeta}
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Linked Topics</h2>
        <TaskTopicPicker
          topics={topics}
          allowDrafts={isDraft}
          selected={task.taskTopicIds}
          onChange={handleTopicsChange}
        />
      </section>

      <section className="mt-6 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Stages</h2>
        <StageEditor task={task} topics={topics} onChange={reload} />
      </section>

      <section className="mt-6 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Status</h2>
        <div className="flex gap-2">
          {task.status !== 'draft' && (
            <button
              onClick={() => handleSetStatus('draft')}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Move to Draft
            </button>
          )}
          {task.status === 'draft' && (
            <button
              onClick={() => handleSetStatus('published')}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Publish
            </button>
          )}
          {task.status !== 'archived' && (
            <button
              onClick={() => handleSetStatus('archived')}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Archive
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
