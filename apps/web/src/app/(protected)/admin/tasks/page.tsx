'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole, useAuth } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { Spinner } from '@web/components/spinner';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { TaskTopicPicker } from '@web/components/tasks/task-topic-picker';
import { StageEditor } from '@web/components/tasks/stage-editor';
import { AdminTasksApiError, type Task, type TaskDetail, type TaskStatus } from '@web/lib/admin-tasks-api';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { Button, Badge } from '@web/components/design-system';

const PUBLISH_REASONS: Record<string, string> = {
  NO_STAGES: 'Add at least one stage before publishing.',
  LINKED_TOPIC_NOT_PUBLISHED: 'Every linked topic must itself be published.',
};

export default function AdminTasksPage() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  // Core state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection & editing
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState('');
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  // Detail pane
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailDescription, setDetailDescription] = useState('');
  const [detailStatus, setDetailStatus] = useState<TaskStatus>('draft');
  const [detailError, setDetailError] = useState('');
  const [detailSaving, setDetailSaving] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<Task | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.adminTasks.list();
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const reloadDetail = useCallback(async (id: string) => {
    try {
      const [detail, topicList] = await Promise.all([
        client.adminTasks.getById(id),
        client.adminTopics.list(),
      ]);
      setTaskDetail(detail);
      setTopics(topicList);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title: detail.title, status: detail.status } : t)));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load task detail');
    }
  }, [client]);

  useEffect(() => {
    if (!authLoading && !canAuthor) {
      router.replace('/dashboard');
      return;
    }
    if (canAuthor) {
      reload();
    }
  }, [canAuthor, reload, authLoading, router]);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setTaskDetail(null);
      setDetailTitle('');
      setDetailDescription('');
      setDetailStatus('draft');
      setPublishErrors([]);
      return;
    }
    setTaskDetail(null);
    setDetailError('');
    setPublishErrors([]);
    void reloadDetail(selectedId);
  }, [selectedId, reloadDetail]);

  useEffect(() => {
    if (!taskDetail) return;
    setDetailTitle(taskDetail.title);
    setDetailDescription(taskDetail.description);
    setDetailStatus(taskDetail.status);
  }, [taskDetail]);

  const handleCreate = async () => {
    try {
      const task = await client.adminTasks.create({ title: 'Untitled task' });
      setTasks((prev) => [task, ...prev]);
      setSelectedId(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    }
  };

  const handleInlineSave = async (id: string, title: string) => {
    if (!title.trim()) {
      setInlineEditId(null);
      return;
    }
    try {
      const updated = await client.adminTasks.update(id, { title: title.trim() });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename task');
    } finally {
      setInlineEditId(null);
    }
  };

  const handleTitleClick = (e: React.MouseEvent, taskId: string) => {
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && last.id === taskId && now - last.time < 300) {
      // Double tap detected - enter edit mode
      e.stopPropagation();
      lastTapRef.current = null;
      setInlineEditId(taskId);
      const task = tasks.find((t) => t.id === taskId);
      if (task) setInlineTitle(task.title);
    } else {
      // First tap or single click - just record the tap, let propagation select the task
      lastTapRef.current = { id: taskId, time: now };
      // Clear the tap history after 300ms if no second tap comes
      setTimeout(() => {
        if (lastTapRef.current && lastTapRef.current.id === taskId && lastTapRef.current.time === now) {
          lastTapRef.current = null;
        }
      }, 300);
    }
  };

  const handleDetailSave = async () => {
    if (!selectedId) return;
    setDetailError('');
    setDetailSaving(true);
    try {
      await client.adminTasks.update(selectedId, {
        title: detailTitle,
        description: detailDescription,
      });
      await reloadDetail(selectedId);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setDetailSaving(false);
    }
  };

  const handleSetStatus = async (status: TaskStatus) => {
    if (!selectedId) return;
    setPublishErrors([]);
    setDetailError('');
    try {
      await client.adminTasks.update(selectedId, { status });
      await reloadDetail(selectedId);
    } catch (e) {
      if (e instanceof AdminTasksApiError && e.code === 'TASK_NOT_PUBLISHABLE') {
        const reasons = (e.details.reasons as string[] | undefined) ?? [];
        setPublishErrors(reasons);
      } else if (e instanceof AdminTasksApiError && e.code === 'INVALID_TRANSITION') {
        setDetailError('That status transition is not allowed.');
      } else {
        setDetailError(e instanceof Error ? e.message : 'Failed to update status');
      }
    }
  };

  const handleTopicsChange = async (next: string[]) => {
    if (!selectedId) return;
    try {
      await client.adminTasks.setTaskTopics(selectedId, next);
      await reloadDetail(selectedId);
    } catch (e) {
      if (e instanceof AdminTasksApiError && e.code === 'LINKED_TOPIC_NOT_PUBLISHED') {
        setDetailError('All linked topics must be published while the task is published.');
      } else {
        setDetailError(e instanceof Error ? e.message : 'Failed to update topic links');
      }
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await client.adminTasks.archive(archiveTarget.id);
      setArchiveTarget(null);
      if (selectedId === archiveTarget.id) setSelectedId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive task');
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (!canAuthor) return null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900 flex-shrink-0">
        <div>
          <h1 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>Tasks</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Create and manage learning tasks</p>
        </div>
        <Button
          onClick={handleCreate}
          variant="primary"
          size="md"
        >
          New Task
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: 'var(--aq-bg)' }}>
        {/* Left: task list — full width on mobile, responsive on desktop */}
        <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full md:max-w-[50%] lg:max-w-[620px] min-w-0 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900`}>
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-zinc-400" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              No tasks yet. Create your first task.
            </p>
          ) : (
            <div className="space-y-1">
              {tasks.map((task) => {
                const isSelected = selectedId === task.id;
                const isInlineEdit = inlineEditId === task.id;

                return (
                  <div key={task.id}>
                    <div
                      className={`group flex items-center gap-2 rounded-lg py-2 px-3 text-sm transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-indigo-400'
                          : 'text-zinc-700 hover:bg-white/50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
                      }`}
                      onClick={() => setSelectedId(task.id)}
                    >
                      {isInlineEdit ? (
                        <input
                          ref={(el) => { if (el) el.focus(); }}
                          value={inlineTitle}
                          onChange={(e) => setInlineTitle(e.target.value)}
                          onBlur={() => handleInlineSave(task.id, inlineTitle)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleInlineSave(task.id, inlineTitle); }
                            if (e.key === 'Escape') setInlineEditId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 flex-1 rounded border border-indigo-300 px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => handleTitleClick(e, task.id)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setInlineEditId(task.id);
                            setInlineTitle(task.title);
                          }}
                          className="min-w-0 flex-1 truncate text-left font-medium text-zinc-900 hover:text-indigo-700 dark:text-zinc-100 dark:hover:text-indigo-300 cursor-text"
                        >
                          {task.title}
                        </button>
                      )}

                      <Badge status={task.status as 'draft' | 'published' | 'archived'} size="sm">
                        {task.status}
                      </Badge>

                      {task.status !== 'archived' && (
                        <button
                          type="button"
                          aria-label={`Archive ${task.title}`}
                          onClick={(e) => { e.stopPropagation(); setArchiveTarget(task); }}
                          className="flex-shrink-0 text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: detail pane */}
        <div className={`${selectedId ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-y-auto p-6 md:p-8`}>
          {/* Mobile back button */}
          {selectedTask && (
            <button
              onClick={() => setSelectedId(null)}
              className="mb-4 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 md:hidden"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to tasks
            </button>
          )}
          {!selectedTask ? (
            <div className="flex h-full flex-col items-center justify-center space-y-4">
              <div className="rounded-full bg-zinc-100 p-6 dark:bg-zinc-800/50">
                <svg className="h-12 w-12 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Select a task to edit its details</p>
            </div>
          ) : !taskDetail ? (
            <div className="flex items-center justify-center py-24">
              <Spinner className="h-6 w-6 text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
                    {detailTitle || 'Untitled Task'}
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Task ID: <code className="font-mono text-xs">{selectedId}</code></p>
                </div>
                <Badge status={detailStatus}>
                  {detailStatus}
                </Badge>
              </div>

              {detailError && (
                <div role="alert" className="rounded-md bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
                  {detailError}
                </div>
              )}

              {publishErrors.length > 0 && (
                <div role="alert" className="rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                  <p className="font-medium">Cannot publish this task yet:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {publishErrors.map((r) => (
                      <li key={r}>{PUBLISH_REASONS[r] ?? r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Meta: title + description */}
              <section className="space-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Title</span>
                  <input
                    type="text"
                    value={detailTitle}
                    onChange={(e) => setDetailTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Description (Markdown)</span>
                  <textarea
                    value={detailDescription}
                    onChange={(e) => setDetailDescription(e.target.value)}
                    rows={6}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>

                {detailDescription && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Preview</p>
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                      <MarkdownViewer content={detailDescription} />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={handleDetailSave}
                    disabled={detailSaving}
                    variant="primary"
                    size="md"
                    isLoading={detailSaving}
                  >
                    Save
                  </Button>
                </div>
              </section>

              {/* Linked Topics */}
              <section className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Linked Topics</h3>
                <TaskTopicPicker
                  topics={topics}
                  allowDrafts={detailStatus === 'draft'}
                  selected={taskDetail.taskTopicIds}
                  onChange={handleTopicsChange}
                />
              </section>

              {/* Stages */}
              <section className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Stages</h3>
                <StageEditor
                  task={taskDetail}
                  topics={topics}
                  onChange={() => reloadDetail(selectedId!)}
                />
              </section>

              {/* Status transitions */}
              <section className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">Status</h3>
                <div className="flex gap-2">
                  {detailStatus !== 'draft' && (
                    <button
                      onClick={() => handleSetStatus('draft')}
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      Move to Draft
                    </button>
                  )}
                  {detailStatus === 'draft' && (
                    <button
                      onClick={() => handleSetStatus('published')}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      Publish
                    </button>
                  )}
                  {detailStatus !== 'archived' && (
                    <button
                      onClick={() => handleSetStatus('archived')}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Archive confirm dialog */}
      {archiveTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm archive"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <p className="mb-4 text-sm text-zinc-700 dark:text-zinc-300">
              Archive &ldquo;{archiveTarget.title}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setArchiveTarget(null)}
                variant="secondary"
                size="md"
              >
                Cancel
              </Button>
              <Button
                onClick={handleArchive}
                variant="danger"
                size="md"
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
