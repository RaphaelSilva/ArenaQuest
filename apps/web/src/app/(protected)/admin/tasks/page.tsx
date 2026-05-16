'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { adminTasksApi, type Task } from '@web/lib/admin-tasks-api';
import { Button, Badge } from '@web/components/design-system';

export default function AdminTasksPage() {
  const router = useRouter();
  const { accessToken: token, isLoading: authLoading } = useAuth();
  const canAuthor = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  // Core state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection & editing
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState('');

  // Detail pane
  const [detailTitle, setDetailTitle] = useState('');
  const [detailStatus, setDetailStatus] = useState<'draft' | 'published' | 'archived'>('draft');
  const [detailError, setDetailError] = useState('');
  const [detailSaving, setDetailSaving] = useState(false);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<Task | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const list = await adminTasksApi.list(token);
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!authLoading && !canAuthor) {
      router.replace('/dashboard');
      return;
    }
    if (canAuthor && token) {
      reload();
    }
  }, [canAuthor, token, reload, authLoading, router]);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedTask) {
      setDetailTitle('');
      setDetailStatus('draft');
      return;
    }
    setDetailTitle(selectedTask.title);
    setDetailStatus(selectedTask.status as 'draft' | 'published' | 'archived');
  }, [selectedId, selectedTask]);

  const handleCreate = async () => {
    if (!token) return;
    try {
      const task = await adminTasksApi.create(token, { title: 'Untitled task' });
      setTasks((prev) => [task, ...prev]);
      setSelectedId(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    }
  };

  const handleInlineSave = async (id: string, title: string) => {
    if (!title.trim() || !token) {
      setInlineEditId(null);
      return;
    }
    try {
      const updated = await adminTasksApi.update(token, id, { title: title.trim() });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename task');
    } finally {
      setInlineEditId(null);
    }
  };

  const handleDetailSave = async () => {
    if (!selectedId || !token) return;
    setDetailError('');
    setDetailSaving(true);
    try {
      const updated = await adminTasksApi.update(token, selectedId, {
        title: detailTitle,
        status: detailStatus,
      });
      setTasks((prev) => prev.map((t) => (t.id === selectedId ? updated : t)));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setDetailSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget || !token) return;
    try {
      await adminTasksApi.archive(token, archiveTarget.id);
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
        {/* Left: task list — full width on mobile, fixed on desktop */}
        <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full md:w-[620px] flex-shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900`}>
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
          ) : (
            <div className="mx-auto max-w-3xl space-y-8">
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

              <form onSubmit={(e) => { e.preventDefault(); handleDetailSave(); }} className="space-y-6" noValidate>
                <div>
                  <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Title
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    value={detailTitle}
                    onChange={(e) => setDetailTitle(e.target.value)}
                    className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                  />
                </div>

                <div>
                  <label htmlFor="task-status" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Status
                  </label>
                  <select
                    id="task-status"
                    value={detailStatus}
                    onChange={(e) => setDetailStatus(e.target.value as typeof detailStatus)}
                    className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                {detailError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="submit"
                    disabled={detailSaving}
                    variant="primary"
                    size="md"
                    isLoading={detailSaving}
                  >
                    Save changes
                  </Button>
                </div>
              </form>
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
